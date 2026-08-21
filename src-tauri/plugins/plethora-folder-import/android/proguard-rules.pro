# Consumer ProGuard rules for the folder-import plugin.
# Keep the Tauri plugin entry point and its annotated command methods so the
# runtime can reflectively bind them.
-keep class com.plethora.folderimport.FolderImportPlugin { *; }
-keep class com.plethora.folderimport.PickFolderOptions { *; }
-keep class com.plethora.folderimport.StagedFile { *; }
-keep @app.tauri.annotation.TauriPlugin class *
-keep @app.tauri.annotation.Command class *
-keep @app.tauri.annotation.InvokeArg class *
-keepclassmembers class * {
    @app.tauri.annotation.ActivityCallback *;
}
