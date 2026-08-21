# Applies only when this library module is itself minified, which it is not in
# the app build. The rules that actually reach the release APK live in
# consumer-rules.pro; keep the two in sync if that ever changes.

-keep class com.plethora.androidgenai.** { *; }
-keep @app.tauri.annotation.TauriPlugin class *
-keep @app.tauri.annotation.Command class *
-keep @app.tauri.annotation.InvokeArg class *
