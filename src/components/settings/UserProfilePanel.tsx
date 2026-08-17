import { useState, useEffect } from "react";
import { useAccountStore } from "../../stores/accountStore";
import { useEntitlementStore } from "../../stores/entitlementStore";
import { usePaywallStore } from "../../stores/paywallStore";
import { CapabilityCatalog } from "../monetization/CapabilityCatalog";
import { TrialBadge } from "../monetization/TrialBadge";
import {
  Crown,
  DeviceMobile,
  Laptop,
  Shield,
  SignOut,
  Sparkle,
  Trash,
  User,
} from "@phosphor-icons/react";
import { LoginModal } from "../auth/LoginModal";
import { useI18n } from "../../lib/i18n";

export function UserProfilePanel() {
  const { t } = useI18n();
  const { isAuthenticated, user, devices, signOut, loadDevices, revokeDevice } = useAccountStore();
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const plan = useEntitlementStore((state) => state.snapshot.plan);
  const openPaywall = usePaywallStore((state) => state.openPaywall);

  useEffect(() => {
    if (isAuthenticated) {
      void loadDevices();
    }
  }, [isAuthenticated, loadDevices]);

  const handleLogout = async () => {
    await signOut();
  };

  const handleOpenPaywall = () => {
    openPaywall({
      capabilityId: 'library_intelligence',
      sourceSurface: 'user_profile_panel',
      title: 'Plethora Pro Membership',
      description: 'Unlock whole-library RAG semantic search, zero-knowledge cloud sync, AI Socratic tutoring, diarized podcast transcription, and neural audiobook voices.',
      quotaDetails: 'Unlimited encrypted sync + monthly AI quota pools',
    });
  };

  const isPro = plan === 'pro';

  return (
    <div className="space-y-6">
      {/* User Info */}
      <div className="bg-card border rounded-lg p-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
            <User className="w-8 h-8 text-primary" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold text-foreground">
                {isAuthenticated && user ? user.email : t("userProfile.guestUser")}
              </h2>
              <TrialBadge />
            </div>
            <div className="flex items-center gap-2 mt-1">
              {isAuthenticated ? (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1 ${
                  !isPro 
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200"
                    : "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-200"
                }`}>
                  {!isPro ? <Shield className="w-3 h-3" /> : <Crown className="w-3 h-3" />}
                  {!isPro ? t("userProfile.freePlan") : t("userProfile.proPlan")}
                </span>
              ) : (
                <span className="px-2 py-0.5 bg-muted text-muted-foreground rounded-full text-xs font-medium">
                  {t("userProfile.demoMode")}
                </span>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {!isPro && (
              <button
                onClick={handleOpenPaywall}
                className="px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-lg transition-all text-sm font-medium flex items-center gap-1.5 shadow-sm"
              >
                <Sparkle className="w-4 h-4" />
                Upgrade to Pro
              </button>
            )}

            {isAuthenticated ? (
              <button
                onClick={handleLogout}
                className="px-4 py-2 bg-destructive/10 text-destructive hover:bg-destructive/20 rounded-lg transition-colors flex items-center gap-2 text-sm"
              >
                <SignOut className="w-4 h-4" />
                {t("userProfile.logOut")}
              </button>
            ) : (
              <button
                onClick={() => setIsLoginOpen(true)}
                className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors text-sm"
              >
                {t("userProfile.signInSignUp")}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Subscription Banner */}
      {!isPro && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-6">
          <div className="flex items-start gap-4">
            <Crown className="w-8 h-8 text-amber-600 dark:text-amber-400 mt-1" />
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-foreground">
                {t("userProfile.upgradeToPro")}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {t("userProfile.proBenefits")}
              </p>
              <button
                onClick={handleOpenPaywall}
                className="mt-4 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                View Plans & 14-Day Free Trial
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Capability Catalog */}
      <div className="bg-card border rounded-lg p-6">
        <CapabilityCatalog />
      </div>


      {/* Devices Registry */}
      {isAuthenticated && devices && devices.length > 0 && (
        <div className="bg-card border rounded-lg p-6 space-y-4">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Laptop className="w-5 h-5 text-primary" />
            Connected Devices
          </h3>
          <div className="divide-y border rounded-lg">
            {devices.map((device) => {
              const isRevoked = !!device.revokedAt;
              return (
                <div key={device.id} className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {device.platform.toLowerCase().includes('mobile') || device.platform.toLowerCase().includes('android') || device.platform.toLowerCase().includes('ios') ? (
                      <DeviceMobile className="w-6 h-6 text-muted-foreground" />
                    ) : (
                      <Laptop className="w-6 h-6 text-muted-foreground" />
                    )}
                    <div>
                      <p className={`text-sm font-medium ${isRevoked ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                        {device.deviceName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {device.platform} • Last seen {new Date(device.lastSeen).toLocaleDateString()}
                        {isRevoked && ' • (Revoked)'}
                      </p>
                    </div>
                  </div>
                  {!isRevoked && (
                    <button
                      onClick={() => revokeDevice(device.id)}
                      className="text-xs px-3 py-1.5 rounded text-destructive hover:bg-destructive/10 transition-colors flex items-center gap-1"
                    >
                      <Trash className="w-3.5 h-3.5" />
                      Revoke
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Login Modal */}
      <LoginModal
        isOpen={isLoginOpen}
        onClose={() => setIsLoginOpen(false)}
      />
    </div>
  );
}
