import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    // Pin the NDK version to match what's installed locally
    // (/opt/homebrew/share/android-commandlinetools/ndk/27.2.12479018). Without
    // this, AGP defaults android.ndkVersion to a different patch (e.g.
    // 27.0.12077973) and the build fails with [CXX1104].
    ndkVersion = "27.2.12479018"
    namespace = "com.plethora.app"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.plethora.app"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    // Release signing credentials are NEVER committed. Resolution order:
    // 1. keystore.properties next to this file (gitignored; see
    //    keystore.properties.example), 2. PLETHORA_KEYSTORE* environment
    //    variables, 3. fall back to the debug keystore so local builds keep
    //    working without any secrets.
    val keystoreProperties = Properties().apply {
        val propFile = file("keystore.properties")
        if (propFile.exists()) {
            propFile.inputStream().use { load(it) }
        }
    }
    val releaseKeystorePath = keystoreProperties.getProperty("storeFile")
        ?: System.getenv("PLETHORA_KEYSTORE_FILE")
    val releaseKeystorePassword = keystoreProperties.getProperty("storePassword")
        ?: System.getenv("PLETHORA_KEYSTORE_PASSWORD")
    val releaseKeyAlias = keystoreProperties.getProperty("keyAlias")
        ?: System.getenv("PLETHORA_KEYSTORE_ALIAS")
    val releaseKeyPassword = keystoreProperties.getProperty("keyPassword")
        ?: System.getenv("PLETHORA_KEYSTORE_KEY_PASSWORD")
    val hasReleaseCredentials = listOf(
        releaseKeystorePath,
        releaseKeystorePassword,
        releaseKeyAlias,
        releaseKeyPassword,
    ).all { !it.isNullOrBlank() } && file(releaseKeystorePath).exists()

    signingConfigs {
        create("release") {
            if (hasReleaseCredentials) {
                storeFile = file(releaseKeystorePath)
                storePassword = releaseKeystorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            } else {
                // No secrets configured (local dev build): sign with the
                // debug key so the build succeeds. CI release builds either
                // inject the properties or sign the APK in a later step
                // (mobile-build.yml signs via apksigner).
                storeFile = file("${System.getProperty("user.home")}/.android/debug.keystore")
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            isMinifyEnabled = true
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")