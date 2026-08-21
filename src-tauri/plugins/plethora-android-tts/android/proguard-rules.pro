# Consumer ProGuard rules for the android-tts plugin.
# Keep the Tauri plugin entry point and its annotated command methods so the
# runtime can reflectively bind them. Also keep the sherpa-onnx JNI surface:
# the native lib references Kotlin class/field names by string, so minification
# would break native->Kotlin callbacks at runtime.

-keep class com.plethora.androidtts.AndroidTtsPlugin { *; }
-keep class com.plethora.androidtts.** { *; }

# sherpa-onnx JNI bindings — the .so looks these up reflectively.
-keep class com.k2fsa.sherpa.onnx.** { *; }

# Tauri annotations.
-keep @app.tauri.annotation.TauriPlugin class *
-keep @app.tauri.annotation.Command class *
-keep @app.tauri.annotation.InvokeArg class *
-keepclassmembers class * {
    @app.tauri.annotation.ActivityCallback *;
}
