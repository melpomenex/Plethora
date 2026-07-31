buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.11.0")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.25")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
        // sherpa-onnx (k2-fsa) is published via JitPack, not Maven Central. The
        // incrementum-android-tts plugin pulls com.github.k2-fsa:sherpa-onnx from
        // here. Declared at the root so every subproject (including :app) can
        // resolve it; module-level repositories are ignored under Tauri's build.
        maven { url = uri("https://jitpack.io") }
    }
}

tasks.register("clean").configure {
    delete("build")
}

