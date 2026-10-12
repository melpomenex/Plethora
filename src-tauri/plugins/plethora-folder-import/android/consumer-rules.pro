# Consumer ProGuard rules for the plethora-folder-import plugin.
# Packaged into the AAR and applied by the consuming app during release R8 minification.
-keep class com.plethora.folderimport.** { *; }
-keep @app.tauri.annotation.TauriPlugin class * { *; }
-keep @app.tauri.annotation.Command class * { *; }
-keep @app.tauri.annotation.InvokeArg class * { *; }
-keepclassmembers class * {
    @app.tauri.annotation.ActivityCallback *;
}
