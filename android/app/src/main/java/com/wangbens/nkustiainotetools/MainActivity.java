package com.wangbens.nkustiainotetools;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    private static final String APP_URL = "https://studynotes.wangbens.com/";
    private static final int FILE_CHOOSER_REQUEST = 1001;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setMediaPlaybackRequiresUserGesture(false);

        webView.addJavascriptInterface(new AndroidDownloadBridge(), "AndroidDownload");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri != null && "studynotes.wangbens.com".equalsIgnoreCase(uri.getHost())) {
                    return false;
                }
                if (uri != null) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (Exception ignored) {
                    }
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // Intercept blob: anchor downloads so .md and .json exports save directly to Android Downloads
                String js = "(function(){"
                    + "if(window.__androidDownloadHooked) return;"
                    + "window.__androidDownloadHooked = true;"
                    + "var origClick = HTMLAnchorElement.prototype.click;"
                    + "HTMLAnchorElement.prototype.click = function(){"
                    + "  if(this.download && this.href && this.href.indexOf('blob:') === 0 && window.AndroidDownload){"
                    + "    var fname = this.download;"
                    + "    fetch(this.href).then(function(r){ return r.text(); }).then(function(txt){"
                    + "      window.AndroidDownload.saveTextFile(fname, txt);"
                    + "    });"
                    + "    return;"
                    + "  }"
                    + "  return origClick.apply(this, arguments);"
                    + "};"
                    + "})();";
                view.evaluateJavascript(js, null);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                WebView webView,
                ValueCallback<Uri[]> callback,
                FileChooserParams params
            ) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                try {
                    Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    String[] mimeTypes = new String[]{
                        "audio/*",
                        "application/json",
                        "application/octet-stream"
                    };
                    intent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes);
                    startActivityForResult(Intent.createChooser(intent, "選擇課堂錄音檔或復原檔"), FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
            }
        });

        webView.loadUrl(APP_URL);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (filePathCallback == null) return;
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                results = new Uri[]{data.getData()};
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    private class AndroidDownloadBridge {
        @JavascriptInterface
        public void saveTextFile(String filename, String content) {
            String safeName = (filename == null || filename.trim().isEmpty())
                ? "study_notes.md"
                : filename.replaceAll("[\\\\/:*?\"<>|]+", "_");
            String mime = safeName.endsWith(".json") ? "application/json" : "text/markdown";
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                    values.put(MediaStore.Downloads.MIME_TYPE, mime);
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri != null) {
                        try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                            if (out != null) {
                                out.write(content.getBytes(StandardCharsets.UTF_8));
                            }
                        }
                    }
                } else {
                    File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    if (dir != null && !dir.exists()) dir.mkdirs();
                    File outFile = new File(dir, safeName);
                    try (FileOutputStream out = new FileOutputStream(outFile)) {
                        out.write(content.getBytes(StandardCharsets.UTF_8));
                    }
                }
                runOnUiThread(() ->
                    Toast.makeText(MainActivity.this, "已儲存至下載資料夾：" + safeName, Toast.LENGTH_LONG).show()
                );
            } catch (Exception e) {
                runOnUiThread(() ->
                    Toast.makeText(MainActivity.this, "儲存失敗：" + e.getMessage(), Toast.LENGTH_LONG).show()
                );
            }
        }
    }
}
