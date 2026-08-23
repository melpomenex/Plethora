plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.plethora.androidsearch"
    compileSdk = 36

    defaultConfig {
        minSdk = 24
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
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
}

dependencies {
    implementation("androidx.core:core-ktx:1.9.0")
    implementation(project(":tauri-android"))
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")

    implementation("androidx.appsearch:appsearch:1.1.0")
    implementation("androidx.appsearch:appsearch-local-storage:1.1.0")
    implementation("com.google.guava:guava:33.3.1-android")
}
