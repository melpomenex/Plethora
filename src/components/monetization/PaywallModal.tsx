import React from 'react';
import { usePaywallStore } from '../../stores/paywallStore';
import { useBillingStore } from '../../stores/billingStore';
import { isPlethoraCloudAvailable } from '../../config/product';

export const PaywallModal: React.FC = () => {
  const { isOpen, activeContext, closePaywall, trial, startTrial } = usePaywallStore();
  const {
    products,
    loading,
    error,
    purchase,
    init,
    usingMockProvider,
    pendingApproval,
  } = useBillingStore();

  if (!isPlethoraCloudAvailable() || !isOpen || !activeContext) return null;

  const proProduct = products.find((p) => p.id.includes('pro')) || products[0];
  const productsFailedToLoad = !loading && !proProduct;

  const handleUpgrade = async () => {
    if (proProduct) {
      await purchase(proProduct.id);
      closePaywall();
    }
  };

  const handleRetryProducts = () => {
    void init();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="paywall-title"
    >
      <div className="bg-bg-elevated border border-border-default rounded-xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-6 border-b border-border-subtle flex justify-between items-start">
          <div>
            <span className="inline-block px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider rounded-full bg-accent-muted text-accent-fg mb-2">
              Plethora Pro
            </span>
            <h2 id="paywall-title" className="text-xl font-bold text-fg-default">
              {activeContext.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={closePaywall}
            aria-label="Close dialog"
            className="text-fg-muted hover:text-fg-default p-1 rounded-lg hover:bg-bg-subtle transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 text-sm text-fg-muted">
          <p className="text-base text-fg-default leading-relaxed">
            {activeContext.description}
          </p>

          {usingMockProvider && (
            <div
              data-testid="paywall-mock-banner"
              className="bg-warning/10 border border-warning/40 text-warning px-3 py-2 rounded-lg text-xs font-medium"
            >
              Development build: billing is running against the mock provider.
              Prices shown are fixtures, not real App Store pricing.
            </div>
          )}

          {pendingApproval && (
            <div
              data-testid="paywall-pending-approval"
              className="bg-accent/10 border border-accent/40 text-accent-fg px-3 py-2 rounded-lg text-xs font-medium"
              role="status"
            >
              Purchase awaiting approval. Your subscription activates
              automatically once the purchase is approved.
            </div>
          )}

          {productsFailedToLoad ? (
            /* Retry state — prices come only from the store provider; none are
               invented when products fail to load (mock-firewall invariant). */
            <div
              data-testid="paywall-product-error"
              className="bg-bg-subtle/50 p-4 rounded-lg border border-border-subtle text-center space-y-3"
              role="alert"
            >
              <p className="text-sm text-fg-default">
                Couldn&apos;t load subscription options
                {error ? ` (${error})` : ''}.
              </p>
              <button
                type="button"
                onClick={handleRetryProducts}
                className="px-4 py-2 text-sm font-medium border border-border-default rounded-lg hover:bg-bg-subtle text-fg-default transition-colors"
              >
                Try again
              </button>
            </div>
          ) : (
            <>
              {activeContext.quotaDetails && (
                <div className="bg-bg-subtle/50 p-3 rounded-lg border border-border-subtle text-xs">
                  <span className="font-semibold text-fg-default">Included Allowance: </span>
                  {activeContext.quotaDetails}
                </div>
              )}

              <div className="bg-bg-subtle/30 p-3 rounded-lg border border-border-subtle/50 text-xs text-fg-muted space-y-1">
                <div className="flex items-center gap-1.5 font-medium text-fg-default">
                  <span>🛡️</span>
                  <span>Privacy & Free Guarantee</span>
                </div>
                <p>
                  Your local library, documents, notes, and spaced repetition review are 100% free forever.
                  Cloud compute is an optional augmentation that never locks your personal data.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-6 bg-bg-subtle/40 border-t border-border-subtle flex flex-col sm:flex-row gap-3 items-center justify-between">
          {!productsFailedToLoad && (
            <div className="text-left w-full sm:w-auto">
              <span className="text-lg font-bold text-fg-default">
                {proProduct?.priceFormatted}
              </span>
              <span className="text-xs text-fg-muted block">Cancel anytime</span>
            </div>
          )}

          <div className="flex gap-2 w-full sm:w-auto">
            {!trial.isActive && !productsFailedToLoad && (
              <button
                type="button"
                onClick={() => {
                  startTrial();
                  closePaywall();
                }}
                className="px-4 py-2 text-sm font-medium border border-border-default rounded-lg hover:bg-bg-subtle text-fg-default transition-colors w-full sm:w-auto"
              >
                14-Day Free Trial
              </button>
            )}

            <button
              type="button"
              onClick={handleUpgrade}
              disabled={loading || productsFailedToLoad}
              className="px-5 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-50 transition-colors shadow-sm w-full sm:w-auto"
            >
              {loading ? 'Processing…' : 'Upgrade to Pro'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
