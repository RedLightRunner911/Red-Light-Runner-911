import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { subscriptionOfferCopy } from './playBilling';

const app = readFileSync('src/v2/main.ts', 'utf8');
const ui = readFileSync('v2/index.html', 'utf8');
const plugin = readFileSync('android/app/src/main/java/io/github/missionaryj/patrolradar/PlayBillingPlugin.java', 'utf8');
const server = readFileSync('supabase/functions/_shared/store.ts', 'utf8');
const verifier = readFileSync('supabase/functions/_shared/play.ts', 'utf8');
const sql = readFileSync('supabase/migrations/20261117000000_play_pro_entitlements.sql', 'utf8');
const ownershipSql = readFileSync('supabase/migrations/20261118000000_pro_purchase_owner_immutable.sql', 'utf8');
const founderSql = readFileSync('supabase/migrations/20261119000000_pro_founder_auto_claim_and_relink.sql', 'utf8');
const endpoint = readFileSync('supabase/functions/pro-entitlement/index.ts', 'utf8');
const billingClient = readFileSync('src/entitlement/playBilling.ts', 'utf8');

describe('Play subscription security boundaries', () => {
  it('never upgrades Pro from the Android purchase callback; only founders, server or cached server status', () => {
    expect(app).toContain('status = await proClient.restore()');
    expect(app).toContain('applyVerified(status)');
    expect(app).toContain('void proClient.purchase()');
    // Free edition short-circuits to unlocked; the verified path is kept behind FREE_EDITION.
    expect(app).toContain('const access = FREE_EDITION ? { pro: true, foundingTester: false } : effectiveAccess({');
    expect(app).toContain('hasVerifiedPro = access.pro');
    expect(app).toContain('trafficCamerasPro = access.pro');
    expect(app).toContain('localFounder = hint.foundingTester');
    expect(app).toContain('saveVerifiedStatus(localStorage, status)');
    // Founder/cached unlock is applied before PlayProClient.create can fail.
    expect(app.indexOf('applyAccess(); // founders')).toBeLessThan(app.indexOf('proClient = await PlayProClient.create()'));
    expect(app).toContain('proClient.claimFounderInstall(installMs)');
    expect(app).toContain('applyTrafficCamEntitlement();');
    expect(app).toContain('tcAlerter.check(f, cams, tcSet, travel().mode, trafficCamerasPro)');
    expect(plugin).not.toContain('SharedPreferences');
    expect(plugin).not.toMatch(/\bsetPro\s*\(/);
    expect(verifier).toContain('/purchases/subscriptionsv2/tokens/');
    expect(server).toContain('await playSubscription(token)');
    expect(server).toContain('productMatches');
  });
  it('offers purchases only through native Play and includes restore and pending flow', () => {
    expect(plugin).toContain('BillingClient.ProductType.SUBS');
    expect(plugin).toContain('PLAN.equals(offer.getBasePlanId())');
    expect(plugin).toContain('PlayOfferChoice.choose');
    expect(readFileSync('android/app/src/main/java/io/github/missionaryj/patrolradar/PlayOfferChoice.java', 'utf8')).toContain('free-trial-10d');
    expect(plugin).toContain('notifyListeners("purchaseUpdated"');
    expect(plugin).toContain('QueryPurchasesParams');
    expect(ui).toContain('id="heat-upgrade"');
    expect(ui).toContain('id="pro-restore"');
    expect(ui).toContain('id="founder-claim"');
  });
  it('keeps private purchase records server-only and founders independent from subscription expiry', () => {
    expect(sql).toContain('alter table public.pro_purchases enable row level security');
    expect(sql).toContain('revoke all on public.pro_purchases');
    expect(sql).toContain('grant all on public.pro_purchases');
    expect(sql).toContain('create table if not exists public.pro_founders');
    expect(server).toContain("source: 'founder'");
    expect(server).toContain('acknowledgeSubscription');
    expect(server).toContain('decideOwnership({');
    expect(server).toContain("db.rpc('relink_pro_purchase'");
    expect(server).toContain('isOwnershipRaceError(error.message) ? LINKED_ELSEWHERE');
    expect(server).not.toContain('30 * 60_000');
    expect(ownershipSql).toContain('old.user_id is distinct from new.user_id');
    expect(ownershipSql).toContain('before update of user_id');
  });
  it('requires authenticated Google Pub/Sub notifications', () => {
    const rtdn = readFileSync('supabase/functions/pro-rtdn/index.ts', 'utf8');
    expect(rtdn).toContain('verifyPubSubPush(req)');
    expect(rtdn).toContain('await refreshToken(token)');
  });
  it('keeps purchases and founder grants when an auth user is deleted, and only verified relinks move owners', () => {
    expect(founderSql).toContain('on delete restrict');
    expect(founderSql).not.toMatch(/references auth\.users\(id\) on delete cascade/i);
    expect(founderSql).toContain("current_setting('patrolradar.pro_relink', true)");
    expect(founderSql).toContain('where token_sha256 = p_token_sha256 and user_id = p_from');
    expect(founderSql).toMatch(/revoke all on function public.relink_pro_purchase[^;]+from PUBLIC, anon, authenticated/);
    expect(founderSql).toMatch(/revoke all on function public.claim_pro_founder_install[^;]+from PUBLIC, anon, authenticated/);
    expect(founderSql).toContain("timestamptz '2026-11-16 19:54:00-06'");
  });
  it('sets an obfuscated checkout account id and surfaces linked-elsewhere errors', () => {
    expect(plugin).toContain('flow.setObfuscatedAccountId(account)');
    expect(plugin).toContain('Settings.Secure.ANDROID_ID');
    expect(plugin).toContain('MessageDigest.getInstance("SHA-256")');
    expect(endpoint).toContain("json(409, { error: LINKED_ELSEWHERE_HELP, code: 'linked_elsewhere' })");
    expect(endpoint).toContain("body.action === 'founder-install'");
  });
  it('mentions the 2-week trial only when Play offers it', () => {
    expect(subscriptionOfferCopy({ price: '$1.99', freeTrial: true })).toEqual({
      priceLabel: '$1.99/month after trial',
      button: 'Start 2-week free trial',
      trialNote: 'Includes a 2-week free trial. You will not be charged until the trial ends. Cancel anytime in Google Play before then and you will not be billed.',
    });
    const base = subscriptionOfferCopy({ price: '$1.99' });
    expect(base.trialNote).toBe('');
    expect(base.button).toBe('Subscribe with Google Play');
    expect(base.priceLabel).toBe('$1.99/month');
  });
  it('stops publishing the debug APK and gates the symbols download', () => {
    const workflow = readFileSync('.github/workflows/android.yml', 'utf8');
    expect(workflow).not.toContain('android-latest');
    expect(workflow).not.toContain('gh release');
    expect(workflow).toContain('patrol-radar-debug-apk');
    expect(workflow).toContain('steps.symbols.outputs.present == \'true\'');
    expect(workflow).not.toContain('continue-on-error: true');
  });
  it('keeps founder auto-claim off unless the env flag is enabled', () => {
    expect(server).toContain('founderAutoClaimEnabled');
    expect(server).not.toContain("=== 'off'");
  });
  it('uses a billing-only auth session, not the chat session', () => {
    expect(billingClient).toContain("PRO_AUTH_STORAGE_KEY = 'pr.pro.auth'");
    expect(billingClient).not.toContain("'pr.chat.auth'");
  });
});

