# Consumer ProGuard rules for the android-genai plugin.
#
# These MUST live here, not in proguard-rules.pro. proguard-rules.pro applies
# only when this library module is itself minified; the app consumes the module
# unminified and runs its own R8 pass over everything. consumerProguardFiles
# ships these rules to that app-level R8 run.
#
# Tauri binds @Command methods reflectively by name.
-keep class com.incrementum.androidgenai.** { *; }

# ML Kit GenAI. The genai AARs already ship consumer rules for their generated
# proto fields, which AGP applies automatically. These cover what those do not:
# the public API surface, reached through AutoValue subclasses (SummarizerOptions
# / SummarizationRequest) and Kotlin `object` singletons (Generation.INSTANCE)
# that R8 can rewrite in ways the Play Services shim does not expect.
-keep class com.google.mlkit.genai.** { *; }
-keep interface com.google.mlkit.genai.** { *; }

# GenAiException carries the numeric error code the plugin maps to typed error
# codes; keeping the accessor keeps that mapping working in release builds.
-keepclassmembers class com.google.mlkit.genai.common.GenAiException {
    public int getErrorCode();
}

# Tauri plugin annotations and the classes carrying them.
-keep @app.tauri.annotation.TauriPlugin class *
-keep @app.tauri.annotation.Command class *
-keep @app.tauri.annotation.InvokeArg class *
-keepclassmembers class * {
    @app.tauri.annotation.ActivityCallback *;
}

# Structured output: the KSP genai-schema-compiler generates
# <Envelope>_GeneratedProvider classes (same package) plus a
# META-INF/services GenerableProvider entry; the ML Kit GenAI runtime loads
# them reflectively by target class when building typed requests. The blanket
# package keep above already covers them — this documents the load path and
# guards against narrowing that rule to hand-written classes only.
-keep class com.incrementum.androidgenai.*_GeneratedProvider { *; }

# The @Generable/@Guide annotations are RUNTIME-retention; keep them visible
# so tooling and any future runtime annotation reads keep working.
-keepattributes RuntimeVisibleAnnotations,RuntimeVisibleParameterAnnotations
