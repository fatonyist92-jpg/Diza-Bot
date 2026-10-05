package com.diza.ai;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Button;
import android.net.http.SslError;

public final class MainActivity extends Activity {
    private static final String PREFS = "diza";
    private static final String KEY_SERVER = "server";
    private static final String DEFAULT_SERVER = "http://127.0.0.1:8799";

    private FrameLayout root;
    private WebView webView;
    private String serverUrl;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);

        SharedPreferences prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        serverUrl = normalize(prefs.getString(KEY_SERVER, DEFAULT_SERVER));
        if (serverUrl == null) serverUrl = DEFAULT_SERVER;

        createWebView();
        openDiza();
    }

    private void createWebView() {
        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " DizaAndroid/1.0");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                String scheme = target.getScheme();
                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                    return false;
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showServerScreen();
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 500) showServerScreen();
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                showServerScreen();
            }
        });
    }

    private void openDiza() {
        webView.setVisibility(WebView.VISIBLE);
        webView.loadUrl(serverUrl);
    }

    private void showServerScreen() {
        webView.setVisibility(WebView.GONE);

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(dp(28), dp(42), dp(28), dp(42));
        panel.setBackgroundColor(Color.BLACK);

        TextView title = label("Diza", 32, Color.WHITE);
        title.setGravity(Gravity.CENTER);
        panel.addView(title);

        TextView detail = label(
                "Server Diza belum terhubung. Jalankan backend Diza, login ChatGPT dengan Codex, lalu buka lagi.",
                14,
                Color.LTGRAY
        );
        detail.setGravity(Gravity.CENTER);
        detail.setPadding(0, dp(10), 0, dp(24));
        panel.addView(detail);

        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setText(serverUrl);
        input.setTextColor(Color.WHITE);
        input.setHintTextColor(Color.GRAY);
        input.setHint("http://127.0.0.1:8799");
        input.setPadding(dp(14), 0, dp(14), 0);
        input.setBackgroundColor(Color.rgb(28, 28, 28));
        panel.addView(input, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(52)
        ));

        Button connect = button("Hubungkan");
        LinearLayout.LayoutParams connectParams = fullButton();
        connectParams.topMargin = dp(14);
        panel.addView(connect, connectParams);

        TextView codex = label("Login ChatGPT: jalankan  codex login  pada server Diza.", 12, Color.LTGRAY);
        codex.setPadding(0, dp(14), 0, 0);
        panel.addView(codex);

        connect.setOnClickListener(v -> {
            String next = normalize(input.getText().toString());
            if (next == null) {
                input.setError("Gunakan localhost HTTP atau alamat HTTPS.");
                return;
            }
            serverUrl = next;
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_SERVER, next).apply();
            root.removeView(panel);
            openDiza();
        });

        root.addView(panel, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
    }

    private String normalize(String raw) {
        if (raw == null) return null;
        String text = raw.trim();
        if (text.isEmpty()) return null;
        Uri uri = Uri.parse(text);
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (scheme == null || host == null) return null;
        boolean localhost = "127.0.0.1".equals(host) || "localhost".equalsIgnoreCase(host);
        if (!"https".equalsIgnoreCase(scheme) && !(localhost && "http".equalsIgnoreCase(scheme))) {
            return null;
        }
        return text.replaceAll("/+$", "");
    }

    private TextView label(String text, int sp, int color) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(sp);
        view.setTextColor(color);
        return view;
    }

    private Button button(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setTextColor(Color.BLACK);
        button.setBackgroundColor(Color.WHITE);
        return button;
    }

    private LinearLayout.LayoutParams fullButton() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onBackPressed() {
        if (webView.getVisibility() == WebView.VISIBLE && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        new AlertDialog.Builder(this)
                .setMessage("Keluar dari Diza?")
                .setNegativeButton("Batal", null)
                .setPositiveButton("Keluar", (dialog, which) -> finishAndRemoveTask())
                .show();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
