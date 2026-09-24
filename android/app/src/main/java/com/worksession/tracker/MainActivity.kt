package com.worksession.tracker

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.webkit.*
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.worksession.tracker.databinding.ActivityMainBinding

/**
 * Main Web Portal Activity for WorkSession Tracker.
 *
 * Hosts https://worksession-tracker.netlify.app with:
 * - Instant local loading via shouldInterceptRequest (assets bundled in APK)
 * - Origin preserved as https://worksession-tracker.netlify.app (HTTPS secure context)
 * - Automatic live API passthrough to Netlify backend functions
 * - HTML5 GPS bridge to Android native location hardware
 * - Zero blank screens on mobile
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null

    companion object {
        private const val TAG = "WorkSessionPortal"
        private const val PORTAL_URL = "https://worksession-tracker.netlify.app"
    }

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val results = if (result.resultCode == RESULT_OK) {
            val data = result.data
            if (data?.clipData != null) {
                val count = data.clipData!!.itemCount
                Array(count) { i -> data.clipData!!.getItemAt(i).uri }
            } else if (data?.data != null) {
                arrayOf(data.data!!)
            } else null
        } else null

        fileUploadCallback?.onReceiveValue(results)
        fileUploadCallback = null
    }

    private val locationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val granted = permissions[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
                      permissions[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        if (granted) {
            binding.webView.reload()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupBackPressHandling()
        setupWebView()
        requestPermissionsIfNeeded()

        // Load the portal URL. With shouldInterceptRequest, the local index.html and assets
        // are served instantly under the https://worksession-tracker.netlify.app origin!
        binding.webView.loadUrl(PORTAL_URL)
    }

    private fun setupBackPressHandling() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (binding.webView.canGoBack()) {
                    binding.webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
    }



    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        binding.webView.setBackgroundColor(Color.parseColor("#070d1a"))

        binding.webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            setGeolocationEnabled(true)
            allowFileAccess = true
            allowContentAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            loadWithOverviewMode = true
            useWideViewPort = true
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
            mediaPlaybackRequiresUserGesture = false
            userAgentString = userAgentString + " WorkSessionAndroidApp/1.0"
        }

        binding.webView.addJavascriptInterface(AndroidLocationBridge(), "AndroidBridge")

        binding.webView.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?
            ) {
                // Grant geolocation permission permanently for the portal origin
                callback?.invoke(origin, true, true)
            }

            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                if (newProgress < 100) {
                    binding.progressBar.visibility = View.VISIBLE
                    binding.progressBar.progress = newProgress
                } else {
                    binding.progressBar.visibility = View.GONE
                }
            }

            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                Log.d(TAG, "JS: [${consoleMessage?.messageLevel()}] ${consoleMessage?.message()} (at ${consoleMessage?.sourceId()}:${consoleMessage?.lineNumber()})")
                return true
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                fileUploadCallback?.onReceiveValue(null)
                fileUploadCallback = filePathCallback

                val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                    type = "*/*"
                    addCategory(Intent.CATEGORY_OPENABLE)
                }

                try {
                    fileChooserLauncher.launch(intent)
                } catch (e: Exception) {
                    fileUploadCallback = null
                    return false
                }
                return true
            }
        }

        binding.webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                val url = request?.url?.toString() ?: return null

                try {
                    // 1. Intercept root HTML page requests -> serve bundled local index.html INSTANTLY
                    if (url == PORTAL_URL ||
                        url == "$PORTAL_URL/" ||
                        url.startsWith("$PORTAL_URL/?") ||
                        url == "$PORTAL_URL/index.html") {
                        val inputStream = assets.open("web/index.html")
                        val headers = mapOf(
                            "Access-Control-Allow-Origin" to "*",
                            "Content-Type" to "text/html; charset=UTF-8"
                        )
                        return WebResourceResponse("text/html", "UTF-8", 200, "OK", headers, inputStream)
                    }

                    // 2. Intercept JavaScript bundle requests -> serve our fixed, null-safe build
                    if ((url.contains("/assets/") && (url.endsWith(".js") || url.contains(".js?"))) ||
                        (url.contains("index-") && url.contains(".js"))) {
                        val jsAsset = assets.list("web/assets")?.firstOrNull { it.endsWith(".js") } ?: "index-R3ezbdpI.js"
                        val inputStream = assets.open("web/assets/$jsAsset")
                        val headers = mapOf(
                            "Access-Control-Allow-Origin" to "*",
                            "Content-Type" to "application/javascript; charset=UTF-8"
                        )
                        return WebResourceResponse("application/javascript", "UTF-8", 200, "OK", headers, inputStream)
                    }

                    // 3. Intercept CSS stylesheet requests -> serve our responsive mobile layout
                    if ((url.contains("/assets/") && (url.endsWith(".css") || url.contains(".css?"))) ||
                        (url.contains("index-") && url.contains(".css"))) {
                        val cssAsset = assets.list("web/assets")?.firstOrNull { it.endsWith(".css") } ?: "index-B4s22Etp.css"
                        val inputStream = assets.open("web/assets/$cssAsset")
                        val headers = mapOf(
                            "Access-Control-Allow-Origin" to "*",
                            "Content-Type" to "text/css; charset=UTF-8"
                        )
                        return WebResourceResponse("text/css", "UTF-8", 200, "OK", headers, inputStream)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error intercepting asset for $url", e)
                }

                // All other requests (e.g. /api/auth/login, /api/activity, Leaflet CDN, OSM tiles)
                // pass through to live HTTPS network seamlessly!
                return super.shouldInterceptRequest(view, request)
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                if (url.startsWith(PORTAL_URL) || url.startsWith("file:///android_asset/")) {
                    return false
                }

                return try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    startActivity(intent)
                    true
                } catch (e: Exception) {
                    false
                }
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                binding.progressBar.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                binding.progressBar.visibility = View.GONE

                // Inject CSS to guarantee any Netlify badges or floating overlays are removed
                val cleanupCss = """
                    (function() {
                        var style = document.createElement('style');
                        style.innerHTML = `
                            [class*="netlify"], [id*="netlify"], iframe[src*="netlify"], .netlify-badge {
                                display: none !important;
                                visibility: hidden !important;
                                pointer-events: none !important;
                            }
                        `;
                        document.head.appendChild(style);
                    })();
                """.trimIndent()
                view?.evaluateJavascript(cleanupCss, null)
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                Log.e(TAG, "WebView error: ${error?.errorCode} - ${error?.description} on ${request?.url}")
                if (request?.isForMainFrame == true) {
                    try {
                        val htmlStream = assets.open("web/index.html")
                        val html = htmlStream.bufferedReader().use { it.readText() }
                        view?.loadDataWithBaseURL(PORTAL_URL, html, "text/html", "UTF-8", null)
                    } catch (e: Exception) {
                        Log.e(TAG, "Error loading fallback HTML", e)
                    }
                }
            }
        }
    }

    private fun requestPermissionsIfNeeded() {
        val fineLocationGranted = ContextCompat.checkSelfPermission(
            this, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        val coarseLocationGranted = ContextCompat.checkSelfPermission(
            this, Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        val permissionsToRequest = mutableListOf<String>()
        if (!fineLocationGranted) permissionsToRequest.add(Manifest.permission.ACCESS_FINE_LOCATION)
        if (!coarseLocationGranted) permissionsToRequest.add(Manifest.permission.ACCESS_COARSE_LOCATION)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val notificationsGranted = ContextCompat.checkSelfPermission(
                this, Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!notificationsGranted) permissionsToRequest.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        if (permissionsToRequest.isNotEmpty()) {
            locationPermissionLauncher.launch(permissionsToRequest.toTypedArray())
        }
    }

    override fun onResume() {
        super.onResume()
        binding.webView.onResume()
    }

    override fun onPause() {
        super.onPause()
        binding.webView.onPause()
    }

    override fun onDestroy() {
        binding.webView.destroy()
        super.onDestroy()
    }

    inner class AndroidLocationBridge {
        @JavascriptInterface
        fun getLastKnownLocation(): String {
            try {
                val lm = getSystemService(LOCATION_SERVICE) as? android.location.LocationManager ?: return "{}"
                val gpsLoc = try { lm.getLastKnownLocation(android.location.LocationManager.GPS_PROVIDER) } catch (e: SecurityException) { null }
                val netLoc = try { lm.getLastKnownLocation(android.location.LocationManager.NETWORK_PROVIDER) } catch (e: SecurityException) { null }
                val passiveLoc = try { lm.getLastKnownLocation(android.location.LocationManager.PASSIVE_PROVIDER) } catch (e: SecurityException) { null }

                val candidates = listOfNotNull(gpsLoc, netLoc, passiveLoc)
                val best = candidates.maxByOrNull { it.time }
                if (best != null) {
                    val obj = org.json.JSONObject()
                    obj.put("latitude", best.latitude)
                    obj.put("longitude", best.longitude)
                    obj.put("accuracy", best.accuracy)
                    obj.put("time", best.time)
                    return obj.toString()
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error in getLastKnownLocation", e)
            }
            return "{}"
        }

        @JavascriptInterface
        fun isLocationEnabled(): Boolean {
            val lm = getSystemService(LOCATION_SERVICE) as? android.location.LocationManager ?: return false
            return lm.isProviderEnabled(android.location.LocationManager.GPS_PROVIDER) ||
                   lm.isProviderEnabled(android.location.LocationManager.NETWORK_PROVIDER)
        }

        @JavascriptInterface
        fun openLocationSettings() {
            try {
                val intent = Intent(android.provider.Settings.ACTION_LOCATION_SOURCE_SETTINGS)
                startActivity(intent)
            } catch (e: Exception) {
                Log.e(TAG, "Cannot open location settings", e)
            }
        }
    }
}