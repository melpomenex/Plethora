# Consumer ProGuard rules for the android-tts plugin.
#
# These MUST live here, not in proguard-rules.pro. proguard-rules.pro applies
# only when this library module is itself minified; the app consumes the module
# unminified and runs its own R8 pass over everything (app/build.gradle.kts sets
# isMinifyEnabled = true for release, and its proguardFiles fileTree covers only
# the app directory). Rules placed there are silently never applied to the
# release APK. consumerProguardFiles ships these rules to that app-level R8 run.
#
# Without them the release build renames the classes below and on-device
# synthesis fails at runtime while debug builds work fine.

# Tauri binds @Command methods reflectively by name.
# Rebrand note: the package moved from com.incrementum.androidtts to
# com.plethora.androidtts; the old rule silently protected nothing.
-keep class com.plethora.androidtts.** { *; }

# sherpa-onnx JNI bindings. libsherpa-onnx-jni.so resolves its Kotlin entry
# points through implicit JNI naming (Java_com_k2fsa_sherpa_onnx_...) and
# constructs result objects by name from native code, so renaming or stripping
# anything in this package breaks native <-> Kotlin calls.
-keep class com.k2fsa.sherpa.onnx.** { *; }
-keepclasseswithmembernames class com.k2fsa.sherpa.onnx.** {
    native <methods>;
}

# Tauri plugin annotations and the classes carrying them.
-keep @app.tauri.annotation.TauriPlugin class *
-keep @app.tauri.annotation.Command class *
-keep @app.tauri.annotation.InvokeArg class *
-keepclassmembers class * {
    @app.tauri.annotation.ActivityCallback *;
}
