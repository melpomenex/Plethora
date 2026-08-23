# Keep the Tauri plugin entry point and its annotated command methods so the
# runtime can reflectively bind them, plus the sherpa-onnx JNI surface.

-keep class com.plethora.androidstt.** { *; }
-keep class com.k2fsa.sherpa.onnx.** { *; }

-keep @app.tauri.annotation.TauriPlugin class *
-keep @app.tauri.annotation.Command class *
-keep @app.tauri.annotation.InvokeArg class *
-keepclassmembers class * {
    @app.tauri.annotation.ActivityCallback *;
}
