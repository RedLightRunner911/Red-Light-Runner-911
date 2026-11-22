package io.github.missionaryj.patrolradar;

import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class PlayOfferChoiceTest {
    private static PlayOfferChoice.Candidate offer(String basePlan, String offerId, String token) {
        return new PlayOfferChoice.Candidate(basePlan, offerId, token, "$1.99", "USD", 1_990_000L);
    }

    @Test public void prefersTheFreeTrialWhenPlayReturnsIt() {
        PlayOfferChoice.Candidate chosen = PlayOfferChoice.choose(Arrays.asList(
            offer("monthly", null, "base-token"),
            offer("monthly", "free-trial-10d", "trial-token"),
            offer("yearly", "free-trial-10d", "other-token")
        ));
        assertEquals("trial-token", chosen.offerToken);
        assertTrue(chosen.freeTrial());
    }

    @Test public void usesTheBasePlanWhenTheTrialIsNotOffered() {
        PlayOfferChoice.Candidate chosen = PlayOfferChoice.choose(Collections.singletonList(
            offer("monthly", null, "base-token")
        ));
        assertEquals("base-token", chosen.offerToken);
        assertFalse(chosen.freeTrial());
    }

    @Test public void treatsAnEmptyOfferIdAsTheBasePlan() {
        PlayOfferChoice.Candidate chosen = PlayOfferChoice.choose(Collections.singletonList(
            offer("monthly", "", "base-token")
        ));
        assertEquals("base-token", chosen.offerToken);
        assertFalse(chosen.freeTrial());
    }

    @Test public void ignoresADifferentPromotionalOffer() {
        assertNull(PlayOfferChoice.choose(Collections.singletonList(
            offer("monthly", "winback-2027", "promo-token")
        )));
    }

    @Test public void returnsNullWithoutAMonthlyPlan() {
        assertNull(PlayOfferChoice.choose(Collections.<PlayOfferChoice.Candidate>emptyList()));
        assertNull(PlayOfferChoice.choose(null));
    }
}
