# Consumer ProGuard rules for the android-stt plugin.
#
# These MUST live here, not in proguard-rules.pro (which applies only when this
# library module is itself minified). The app consumes the module unminified and
# runs its own R8 pass, so these rules ship to that app-level run.

# Tauri binds @Command methods reflectively by name.
-keep class com.plethora.androidstt.** { *; }

# sherpa-onnx JNI bindings — shared pin with the android-tts plugin (see its
# consumer-rules.pro; the keep rules are idempotent if both ship).
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
