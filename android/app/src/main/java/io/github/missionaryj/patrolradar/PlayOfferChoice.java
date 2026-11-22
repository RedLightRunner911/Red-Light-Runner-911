package io.github.missionaryj.patrolradar;

import java.util.List;

/**
 * Picks the Play subscription offer token for patrol_radar_pro / monthly.
 * Play only returns offers the signed-in account is eligible for, so the
 * free-trial offer is used when it is present and the base plan otherwise.
 * Other offer ids are ignored.
 */
public final class PlayOfferChoice {
    public static final String BASE_PLAN_ID = "monthly";
    /** Play offer id. The offer itself is a 14-day trial; the id was not renamed. */
    public static final String TRIAL_OFFER_ID = "free-trial-10d";

    public static final class Candidate {
        public final String basePlanId;
        /** Null or empty for the base plan with no offer. */
        public final String offerId;
        public final String offerToken;
        public final String formattedPrice;
        public final String currencyCode;
        public final long priceAmountMicros;

        public Candidate(String basePlanId, String offerId, String offerToken,
                         String formattedPrice, String currencyCode, long priceAmountMicros) {
            this.basePlanId = basePlanId;
            this.offerId = offerId;
            this.offerToken = offerToken;
            this.formattedPrice = formattedPrice;
            this.currencyCode = currencyCode;
            this.priceAmountMicros = priceAmountMicros;
        }

        public boolean freeTrial() {
            return TRIAL_OFFER_ID.equals(offerId);
        }
    }

    private PlayOfferChoice() {}

    /** The offer to sell, or null when the monthly base plan is not in the list. */
    public static Candidate choose(List<Candidate> offers) {
        Candidate trial = null;
        Candidate base = null;
        if (offers == null) return null;
        for (Candidate offer : offers) {
            if (offer == null || !BASE_PLAN_ID.equals(offer.basePlanId)) continue;
            if (offer.offerToken == null || offer.offerToken.isEmpty()) continue;
            if (TRIAL_OFFER_ID.equals(offer.offerId)) trial = offer;
            else if (offer.offerId == null || offer.offerId.isEmpty()) base = offer;
        }
        if (trial != null) return trial;
        return base;
    }
}
