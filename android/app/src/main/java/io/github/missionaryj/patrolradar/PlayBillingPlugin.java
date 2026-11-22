package io.github.missionaryj.patrolradar;

import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryProductDetailsResult;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.provider.Settings;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Google Play is the checkout UI. This plugin never grants Pro: only our verifier can. */
@CapacitorPlugin(name = "PlayBilling")
public final class PlayBillingPlugin extends Plugin implements PurchasesUpdatedListener {
    private static final String PRODUCT = "patrol_radar_pro";
    private static final String PLAN = "monthly";
    private BillingClient billing;
    private ProductDetails currentProduct;
    private String offerToken;
    private String accountHash;

    /**
     * Stable, non-reversible checkout account id: SHA-256 of a fixed salt plus Settings.Secure.ANDROID_ID.
     * ANDROID_ID is scoped to this app's signing key, user and device and survives reinstall (Android 8+),
     * so the verifier can recognise a reinstall on the same phone. Never sent raw; 64 hex chars (Play limit).
     */
    String accountHash() {
        if (accountHash != null) return accountHash;
        try {
            String id = Settings.Secure.getString(getContext().getContentResolver(), Settings.Secure.ANDROID_ID);
            if (id == null || id.isEmpty()) return null;
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(("patrol-radar-play-account-v1:" + id).getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(64);
            for (byte b : digest) hex.append(String.format("%02x", b));
            accountHash = hex.toString();
        } catch (Exception e) {
            accountHash = null;
        }
        return accountHash;
    }

    private void connect(PluginCall call, Runnable ready) {
        if (billing == null) {
            billing = BillingClient.newBuilder(getContext())
                .setListener(this)
                .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                .enableAutoServiceReconnection()
                .build();
        }
        if (billing.isReady()) { ready.run(); return; }
        billing.startConnection(new BillingClientStateListener() {
            @Override public void onBillingSetupFinished(BillingResult result) {
                if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) ready.run();
                else call.reject("Google Play Billing unavailable (" + result.getResponseCode() + ")");
            }
            @Override public void onBillingServiceDisconnected() {
                // Reconnection is automatic on subsequent requests.
            }
        });
    }

    private void queryProduct(PluginCall call, boolean forPurchase) {
        connect(call, () -> {
            QueryProductDetailsParams.Product product = QueryProductDetailsParams.Product.newBuilder()
                .setProductId(PRODUCT).setProductType(BillingClient.ProductType.SUBS).build();
            QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                .setProductList(Collections.singletonList(product)).build();
            billing.queryProductDetailsAsync(params, (result, products) -> {
                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    call.reject("Could not read Play subscription (" + result.getResponseCode() + ")");
                    return;
                }
                List<PlayOfferChoice.Candidate> candidates = new ArrayList<>();
                List<ProductDetails> list = products.getProductDetailsList();
                if (list != null) for (ProductDetails detail : list) {
                    if (!PRODUCT.equals(detail.getProductId()) || detail.getSubscriptionOfferDetails() == null) continue;
                    for (ProductDetails.SubscriptionOfferDetails offer : detail.getSubscriptionOfferDetails()) {
                        // Monthly base plan only. The trial offer is preferred when Play includes it.
                        if (!PLAN.equals(offer.getBasePlanId())) continue;
                        List<ProductDetails.PricingPhase> phases = offer.getPricingPhases().getPricingPhaseList();
                        if (phases == null || phases.isEmpty()) continue;
                        ProductDetails.PricingPhase price = phases.get(phases.size() - 1);
                        candidates.add(new PlayOfferChoice.Candidate(
                            offer.getBasePlanId(), offer.getOfferId(), offer.getOfferToken(),
                            price.getFormattedPrice(), price.getPriceCurrencyCode(), price.getPriceAmountMicros()));
                    }
                }
                PlayOfferChoice.Candidate chosen = PlayOfferChoice.choose(candidates);
                ProductDetails matched = null;
                if (chosen != null && list != null) for (ProductDetails detail : list) {
                    if (detail.getSubscriptionOfferDetails() == null) continue;
                    for (ProductDetails.SubscriptionOfferDetails offer : detail.getSubscriptionOfferDetails()) {
                        if (chosen.offerToken.equals(offer.getOfferToken())) { matched = detail; break; }
                    }
                    if (matched != null) break;
                }
                if (matched == null || chosen == null) {
                    call.reject("Monthly Pro is not available for this Play account or testing track.");
                    return;
                }
                currentProduct = matched;
                offerToken = chosen.offerToken;
                String formattedPrice = chosen.formattedPrice;
                String currencyCode = chosen.currencyCode;
                long priceAmountMicros = chosen.priceAmountMicros;
                boolean freeTrial = chosen.freeTrial();
                if (forPurchase) {
                    if (getActivity() == null) { call.reject("No activity for Play checkout"); return; }
                    BillingFlowParams.ProductDetailsParams item = BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(currentProduct).setOfferToken(offerToken).build();
                    BillingFlowParams.Builder flow = BillingFlowParams.newBuilder()
                        .setProductDetailsParamsList(Collections.singletonList(item));
                    // Lets the verifier prove a reinstall on this phone owns the purchase (reinstall recovery).
                    String account = accountHash();
                    if (account != null) flow.setObfuscatedAccountId(account);
                    BillingResult launch = billing.launchBillingFlow(getActivity(), flow.build());
                    if (launch.getResponseCode() != BillingClient.BillingResponseCode.OK)
                        call.reject("Play checkout unavailable (" + launch.getResponseCode() + ")");
                    else { JSObject out = new JSObject(); out.put("launched", true); call.resolve(out); }
                } else {
                    JSObject out = new JSObject();
                    out.put("productId", PRODUCT);
                    out.put("basePlanId", PLAN);
                    out.put("price", formattedPrice);
                    out.put("currencyCode", currencyCode);
                    out.put("priceAmountMicros", priceAmountMicros);
                    out.put("freeTrial", freeTrial);
                    out.put("offerId", chosen.offerId);
                    call.resolve(out);
                }
            });
        });
    }

    @PluginMethod public void getProduct(PluginCall call) { queryProduct(call, false); }
    @PluginMethod public void purchase(PluginCall call) { queryProduct(call, true); }

    @PluginMethod public void account(PluginCall call) {
        JSObject out = new JSObject();
        out.put("accountHash", accountHash());
        call.resolve(out);
    }

    @PluginMethod public void restore(PluginCall call) {
        connect(call, () -> {
            QueryPurchasesParams params = QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.SUBS).build();
            billing.queryPurchasesAsync(params, (result, purchases) -> {
                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    call.reject("Could not restore Play purchases (" + result.getResponseCode() + ")");
                    return;
                }
                JSObject out = new JSObject();
                JSArray rows = new JSArray();
                for (Purchase p : purchases) {
                    if (p.getProducts().contains(PRODUCT)) rows.put(toJson(p));
                }
                out.put("purchases", rows);
                call.resolve(out);
            });
        });
    }

    private JSObject toJson(Purchase purchase) {
        JSObject out = new JSObject();
        out.put("productId", PRODUCT);
        out.put("purchaseToken", purchase.getPurchaseToken());
        out.put("state", purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED ? "purchased" :
            purchase.getPurchaseState() == Purchase.PurchaseState.PENDING ? "pending" : "unknown");
        out.put("acknowledged", purchase.isAcknowledged());
        return out;
    }

    @Override public void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
        if (result.getResponseCode() == BillingClient.BillingResponseCode.OK && purchases != null) {
            for (Purchase purchase : purchases) if (purchase.getProducts().contains(PRODUCT))
                notifyListeners("purchaseUpdated", toJson(purchase), true);
        } else {
            JSObject out = new JSObject();
            out.put("code", result.getResponseCode());
            out.put("cancelled", result.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED);
            notifyListeners("purchaseError", out);
        }
    }

    @Override protected void handleOnDestroy() {
        if (billing != null) billing.endConnection();
        super.handleOnDestroy();
    }
}
