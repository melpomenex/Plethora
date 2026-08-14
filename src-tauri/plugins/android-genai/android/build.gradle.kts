plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("com.google.devtools.ksp")
}

android {
    namespace = "com.incrementum.androidgenai"
    compileSdk = 36

    defaultConfig {
        minSdk = 24
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
        // Compile-time half of structured-output negotiation. The runtime
        // half still checks ML Kit on the current device; callers never infer
        // feature support from a device model name.
        buildConfigField("boolean", "STRUCTURED_OUTPUT_COMPILED", "true")
        buildConfigField("boolean", "IMAGE_PROMPT_COMPILED", "true")
        buildConfigField("boolean", "MULTI_IMAGE_COMPILED", "true")
        buildConfigField("boolean", "STREAMING_COMPILED", "true")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.9.0")
    implementation("androidx.appcompat:appcompat:1.6.0")
    // ML Kit GenAI — Gemini Nano through the system AICore service. Declared
    // only here, not in gen/android/app/build.gradle.kts: `implementation` in
    // this module already reaches the APK, and this file survives
    // `tauri android init` regeneration.
    //
    // genai-summarization has one published version and is pure Java.
    //
    // genai-prompt is Kotlin, and its metadata version is what forced the
    // project's Android Kotlin plugin to 2.x (see docs/android-build-notes.md).
    // beta4 and the alpha1 schema compiler are the coordinated structured-
    // output spike; beta2 remains the documented build-verified fallback.
    implementation("com.google.mlkit:genai-summarization:1.0.0-beta1")
    implementation("com.google.mlkit:genai-prompt:1.0.0-beta4")
    ksp("com.google.mlkit:genai-schema-compiler:1.0.0-alpha1")
    // ListenableFuture: both ML Kit GenAI clients return Guava futures.
    implementation("com.google.guava:guava:33.3.1-android")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
    // Tauri Android runtime (Plugin/Invoke/JSObject/annotations).
    implementation(project(":tauri-android"))
}
