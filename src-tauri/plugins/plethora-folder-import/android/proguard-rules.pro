# Consumer ProGuard rules for the plethora-folder-import plugin.
# Keep the Tauri plugin entry point, argument classes, and annotated methods.
-keep class com.plethora.folderimport.** { *; }
-keep @app.tauri.annotation.TauriPlugin class * { *; }
-keep @app.tauri.annotation.Command class * { *; }
-keep @app.tauri.annotation.InvokeArg class * { *; }
-keepclassmembers class * {
    @app.tauri.annotation.ActivityCallback *;
}
