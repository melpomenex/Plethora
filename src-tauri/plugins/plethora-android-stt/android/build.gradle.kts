plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.plethora.androidstt"
    compileSdk = 36

    defaultConfig {
        minSdk = 24
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
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

repositories {
    google()
    mavenCentral()
    // sherpa-onnx (k2-fsa) is published via JitPack, not Maven Central.
    maven { url = uri("https://jitpack.io") }
}

dependencies {
    implementation("androidx.core:core-ktx:1.9.0")
    // sherpa-onnx native inference runtime — LOCKSTEP PIN: must match the
    // version in plugins/plethora-android-tts/android/build.gradle.kts exactly
    // (both land in the same APK; two copies of libsherpa-onnx-jni.so with
    // different JNI surfaces break whichever loads second). Bump only in
    // lockstep with a device test pass. OfflineRecognizer / OfflineStream /
    // Vad / SileroVadModelConfig live in com.k2fsa.sherpa.onnx.
    implementation("com.github.k2-fsa:sherpa-onnx:1.13.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    // Tauri Android runtime (Plugin/Invoke/JSObject/annotations).
    implementation(project(":tauri-android"))
}
