# Keep Tauri's reflective plugin entry point in minified builds.
-keep class com.plethora.navigation.NavigationPlugin { *; }

# Jackson parses these mutable IPC fields by reflection after R8.
-keep @app.tauri.annotation.InvokeArg class com.plethora.navigation.** { *; }
