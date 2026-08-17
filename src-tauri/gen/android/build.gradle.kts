buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.11.0")
        // HAND EDIT — re-apply after `tauri android init` (see
        // docs/android-build-notes.md). ML Kit GenAI's genai-prompt artifacts
        // carry Kotlin 2.x metadata, which a 1.9.x compiler cannot read:
        // `:plethora-android-genai:compileReleaseKotlin` fails with
        // "compiled with an incompatible version of Kotlin". Prompt beta4's
        // structured-output compiler is being verified with this coordinated
        // Kotlin/KSP pin.
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.21")
        classpath("com.google.devtools.ksp:com.google.devtools.ksp.gradle.plugin:2.3.11")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
        // sherpa-onnx (k2-fsa) is published via JitPack, not Maven Central. The
        // plethora-android-tts plugin pulls com.github.k2-fsa:sherpa-onnx from
        // here. Declared at the root so every subproject (including :app) can
        // resolve it; module-level repositories are ignored under Tauri's build.
        maven { url = uri("https://jitpack.io") }
    }
}

tasks.register("clean").configure {
    delete("build")
}
