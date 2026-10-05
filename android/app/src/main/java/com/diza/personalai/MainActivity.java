package com.diza.personalai;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.net.HttpURLConnection;
import java.net.URL;

public final class MainActivity extends Activity {
    private static final String PREFS = "diza_native";
    private static final String KEY_SERVER = "server_url";
    private static final String DEFAULT_SERVER = "http://127.0.0.1:8788";
    private static final String APP_URL = "file:///android_asset/www/index.html";
    private static final int FILE_REQUEST = 4107;

    private FrameLayout root;
    private WebView webView;
    private View overlay;
    private String currentServer;
    private ValueCallback<Uri[]> fileCallback;
    private Uri captureUri;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.BLACK);
        getWindow().setNavigationBarColor(Color.BLACK);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);

        configureWebView();

        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        currentServer = normalizeServer(prefs.getString(KEY_SERVER, DEFAULT_SERVER));
        if (currentServer == null) currentServer = DEFAULT_SERVER;
        loadBundledApp();
    }

    private void configureWebView() {
        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setUserAgentString(settings.getUserAgentString() + " DIZA-Android/0.1");

        webView.addJavascriptInterface(new NativeBridge(), "DizaNative");
        webView.setWebChromeClient(new DizaChromeClient());
        webView.setWebViewClient(new DizaWebClient());
    }

    private void loadServer(String raw) {
        String normalized = normalizeServer(raw);
        if (normalized == null) {
            showServerSetup(raw);
            return;
        }
        currentServer = normalized;
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_SERVER, normalized).apply();
        loadBundledApp();
    }

    private void loadBundledApp() {
        removeOverlay();
        webView.loadUrl(APP_URL);
    }

    private String normalizeServer(String raw) {
        if (raw == null) return null;
        String text = raw.trim();
        if (text.isEmpty()) return null;
        Uri uri = Uri.parse(text);
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (scheme == null || host == null || host.isEmpty()) return null;
        if (uri.getUserInfo() != null) return null;

        boolean local = "localhost".equalsIgnoreCase(host) || "127.0.0.1".equals(host);
        boolean secure = "https".equalsIgnoreCase(scheme);
        boolean localHttp = local && "http".equalsIgnoreCase(scheme);
        if (!secure && !localHttp) return null;

        String authority = uri.getEncodedAuthority();
        if (authority == null || authority.isEmpty()) return null;
        return scheme.toLowerCase() + "://" + authority;
    }

    private boolean sameServer(Uri uri) {
        if (uri == null || currentServer == null) return false;
        Uri current = Uri.parse(currentServer);
        return safeEquals(current.getScheme(), uri.getScheme())
                && safeEquals(current.getHost(), uri.getHost())
                && effectivePort(current) == effectivePort(uri);
    }

    private int effectivePort(Uri uri) {
        if (uri.getPort() >= 0) return uri.getPort();
        return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }

    private boolean safeEquals(String a, String b) {
        return a == null ? b == null : a.equalsIgnoreCase(b);
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
        }
    }

    private void injectServerIntoWeb() {
        String quoted = JSONObject.quote(currentServer == null ? DEFAULT_SERVER : currentServer);
        webView.evaluateJavascript(
                "try{localStorage.setItem('diza-server-url'," + quoted + ");}catch(e){}",
                null
        );
    }

    private void showOffline() {
        removeOverlay();
        LinearLayout box = baseOverlay();

        TextView title = text("DIZA tidak dapat dimuat", 20, Color.WHITE);
        title.setGravity(Gravity.CENTER);
        box.addView(title);

        TextView detail = text(
                "Aplikasi lokal gagal dimuat. Coba lagi, atau ubah server dari pengaturan.",
                13,
                Color.LTGRAY
        );
        detail.setGravity(Gravity.CENTER);
        detail.setPadding(0, dp(10), 0, dp(20));
        box.addView(detail);

        Button retry = button("Coba Lagi");
        retry.setOnClickListener(v -> loadBundledApp());
        box.addView(retry, buttonLayout());

        Button change = button("Ubah Server");
        change.setOnClickListener(v -> showServerSetup(currentServer));
        LinearLayout.LayoutParams changeParams = buttonLayout();
        changeParams.topMargin = dp(10);
        box.addView(change, changeParams);

        overlay = box;
        root.addView(box, fullLayout());
    }

    private void showServerSetup(String seed) {
        removeOverlay();
        LinearLayout box = baseOverlay();

        TextView brand = text("DIZA AI", 34, Color.WHITE);
        brand.setGravity(Gravity.CENTER);
        box.addView(brand);

        TextView subtitle = text("Pengaturan Server", 14, Color.LTGRAY);
        subtitle.setGravity(Gravity.CENTER);
        subtitle.setPadding(0, dp(8), 0, dp(22));
        box.addView(subtitle);

        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setTextColor(Color.WHITE);
        input.setHintTextColor(Color.GRAY);
        input.setHint("https://xxxxxxxx.hostc.app");
        input.setBackgroundColor(Color.rgb(28, 28, 28));
        input.setPadding(dp(14), 0, dp(14), 0);

        String normalizedSeed = normalizeServer(seed);
        if (normalizedSeed != null) {
            input.setText(normalizedSeed);
        } else {
            String clipboard = serverFromClipboard();
            input.setText(clipboard != null ? clipboard : DEFAULT_SERVER);
        }
        box.addView(input, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(52)
        ));

        TextView note = text(
                "Gunakan server lokal Termux atau URL HTTPS HostC. Alamat ini dapat diubah lagi dari Pengaturan DIZA.",
                12,
                Color.LTGRAY
        );
        note.setPadding(0, dp(10), 0, dp(18));
        box.addView(note);

        Button save = button("Simpan & Buka DIZA");
        save.setOnClickListener(v -> {
            String normalized = normalizeServer(input.getText().toString());
            if (normalized == null) {
                input.setError("Gunakan URL HTTPS, atau HTTP untuk localhost/127.0.0.1.");
                return;
            }
            loadServer(normalized);
        });
        box.addView(save, buttonLayout());

        overlay = box;
        root.addView(box, fullLayout());
    }

    private LinearLayout baseOverlay() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setPadding(dp(28), dp(40), dp(28), dp(40));
        box.setBackgroundColor(Color.BLACK);
        return box;
    }

    private TextView text(String value, int sp, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        return view;
    }

    private Button button(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(Color.BLACK);
        button.setBackgroundColor(Color.WHITE);
        button.setAllCaps(false);
        return button;
    }

    private LinearLayout.LayoutParams buttonLayout() {
        return new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(50)
        );
    }

    private FrameLayout.LayoutParams fullLayout() {
        return new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        );
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private String serverFromClipboard() {
        try {
            ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (clipboard == null || !clipboard.hasPrimaryClip()) return null;
            ClipData clip = clipboard.getPrimaryClip();
            if (clip == null || clip.getItemCount() == 0) return null;
            CharSequence value = clip.getItemAt(0).coerceToText(this);
            return normalizeServer(value == null ? null : value.toString());
        } catch (Exception ignored) {
            return null;
        }
    }

    private void removeOverlay() {
        if (overlay != null) {
            root.removeView(overlay);
            overlay = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (overlay != null) {
            removeOverlay();
            loadBundledApp();
            return;
        }
        webView.evaluateJavascript("history.back()", null);
    }

    @Override
    protected void onDestroy() {
        if (fileCallback != null) {
            fileCallback.onReceiveValue(null);
            fileCallback = null;
        }
        if (webView != null) {
            webView.removeJavascriptInterface("DizaNative");
            webView.destroy();
        }
        super.onDestroy();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_REQUEST) {
            Uri[] result = null;
            if (resultCode == RESULT_OK) {
                if (captureUri != null && (data == null || data.getData() == null)) {
                    result = new Uri[]{captureUri};
                } else if (data != null && data.getClipData() != null) {
                    ClipData clip = data.getClipData();
                    result = new Uri[clip.getItemCount()];
                    for (int i = 0; i < clip.getItemCount(); i++) result[i] = clip.getItemAt(i).getUri();
                } else if (data != null && data.getData() != null) {
                    result = new Uri[]{data.getData()};
                }
            }
            if (fileCallback != null) fileCallback.onReceiveValue(result);
            fileCallback = null;
            captureUri = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private final class DizaWebClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String scheme = uri.getScheme();
            if (("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) && sameServer(uri)) {
                return false;
            }
            openExternal(uri);
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            removeOverlay();
            injectServerIntoWeb();

            // Native smoke-test fallback: only report ready after the bundled
            // React app has actually mounted content into #root.
            view.postDelayed(() -> view.evaluateJavascript(
                    "(function(){var r=document.getElementById('root');return !!(r&&r.childElementCount>0);})()",
                    value -> {
                        if ("true".equals(value)) Log.i("DIZA", "DIZA_UI_READY");
                    }
            ), 1200);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showOffline();
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (request.isForMainFrame() && response.getStatusCode() >= 500) showOffline();
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            handler.cancel();
            showOffline();
        }
    }

    private final class DizaChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(
                WebView view,
                ValueCallback<Uri[]> callback,
                FileChooserParams params
        ) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            captureUri = null;

            String[] accepts = params.getAcceptTypes();
            String joined = accepts == null ? "" : String.join(",", accepts).toLowerCase();
            boolean image = joined.contains("image/");
            boolean video = joined.contains("video/");

            try {
                Intent intent;
                if (params.isCaptureEnabled() && image) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Images.Media.DISPLAY_NAME, "diza-camera-" + System.currentTimeMillis() + ".jpg");
                    values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                    captureUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                    intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                    if (captureUri != null) intent.putExtra(MediaStore.EXTRA_OUTPUT, captureUri);
                } else if (params.isCaptureEnabled() && video) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Video.Media.DISPLAY_NAME, "diza-video-" + System.currentTimeMillis() + ".mp4");
                    values.put(MediaStore.Video.Media.MIME_TYPE, "video/mp4");
                    captureUri = getContentResolver().insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);
                    intent = new Intent(MediaStore.ACTION_VIDEO_CAPTURE);
                    if (captureUri != null) intent.putExtra(MediaStore.EXTRA_OUTPUT, captureUri);
                } else {
                    intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                    if (image && !video) intent.setType("image/*");
                    else if (video && !image) intent.setType("video/*");
                    else intent.setType("*/*");
                    if (accepts != null && accepts.length > 1) intent.putExtra(Intent.EXTRA_MIME_TYPES, accepts);
                }
                startActivityForResult(intent, FILE_REQUEST);
                return true;
            } catch (Exception error) {
                fileCallback.onReceiveValue(null);
                fileCallback = null;
                captureUri = null;
                return false;
            }
        }
    }

    public final class NativeBridge {
        @JavascriptInterface
        public String getServerUrl() {
            return currentServer == null ? DEFAULT_SERVER : currentServer;
        }

        @JavascriptInterface
        public void setServerUrl(String raw) {
            final String normalized = normalizeServer(raw);
            if (normalized == null) return;
            runOnUiThread(() -> loadServer(normalized));
        }

        @JavascriptInterface
        public void clearServerUrl() {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(KEY_SERVER).apply();
            runOnUiThread(() -> loadServer(DEFAULT_SERVER));
        }

        @JavascriptInterface
        public void reportReady() {
            Log.i("DIZA", "DIZA_UI_READY");
        }

        @JavascriptInterface
        public String testServer(String raw) {
            String normalized = normalizeServer(raw);
            if (normalized == null) return "Alamat server tidak valid.";
            HttpURLConnection connection = null;
            try {
                URL url = new URL(normalized + "/api/health");
                connection = (HttpURLConnection) url.openConnection();
                connection.setConnectTimeout(5000);
                connection.setReadTimeout(5000);
                connection.setInstanceFollowRedirects(true);
                connection.setRequestMethod("GET");
                connection.setRequestProperty("Accept", "application/json");
                int code = connection.getResponseCode();
                return code == 200 ? "ok" : "Server menjawab HTTP " + code + ".";
            } catch (Exception error) {
                return "Server tidak dapat dihubungi.";
            } finally {
                if (connection != null) connection.disconnect();
            }
        }

        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(MainActivity.this::finishAndRemoveTask);
        }
    }
}
