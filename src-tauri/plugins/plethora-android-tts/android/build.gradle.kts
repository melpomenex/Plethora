plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.plethora.androidtts"
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
    // sherpa-onnx (k2-fsa) is published via JitPack, not Maven Central. The AAR
    // carries arm64-v8a / armeabi-v7a / x86 / x86_64 native libs and the Kotlin
    // JNI bindings under package com.k2fsa.sherpa.onnx.
    // See https://github.com/k2-fsa/sherpa-onnx and design.md Decision 2.
    maven { url = uri("https://jitpack.io") }
}

dependencies {
    implementation("androidx.core:core-ktx:1.9.0")
    implementation("androidx.appcompat:appcompat:1.6.0")
    // sherpa-onnx native inference runtime (Apache-2.0). Pinned: a version bump
    // is an explicit change because the model-config API can move between
    // releases. OfflineTts / OfflineTtsKittenModelConfig /
    // OfflineTtsKokoroModelConfig all live in com.k2fsa.sherpa.onnx.
    implementation("com.github.k2-fsa:sherpa-onnx:1.13.4")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
    // Tauri Android runtime (Plugin/Invoke/JSObject/annotations).
    implementation(project(":tauri-android"))
}
