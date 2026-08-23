// On-demand Play Feature Delivery skeleton (OpenSpec H).
// Not applied by default. Enable only with -Pplethora.playAiPacks=true
// after a licensed generative artifact exists. Never ship a multi-GB pack
// in the base APK.
//
//   android {
//     ...
//   }
//   // apply from this file in the app module, behind the Gradle property.

val enablePlayAiPacks = providers.gradleProperty("plethora.playAiPacks")
    .map { it == "true" }
    .orElse(false)

if (enablePlayAiPacks.get()) {
    // Placeholder: register an install-time=false asset pack here.
    // Example (uncomment when a licensed pack id is recorded):
    // android {
    //     assetPacks += listOf(":licensed-gen-pack")
    // }
}
