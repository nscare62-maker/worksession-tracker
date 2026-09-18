# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in the Android SDK tools proguard/proguard-android.txt

# Keep Retrofit/OkHttp
-keepattributes Signature
-keepattributes Exceptions
-keep class retrofit2.** { *; }
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }

# Keep Gson models
-keepattributes *Annotation*
-keep class com.worksession.tracker.data.models.** { *; }

# Keep ViewModel names for reflection
-keep class androidx.lifecycle.** { *; }
