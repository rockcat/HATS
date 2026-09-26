/// The HATS animated avatar, shared by every Flutter client.
///
/// A VRM or GLB model in a WebView, lip-synced to the viseme timings the
/// Speech Service produces. Extracted from the team client so the personal
/// assistant app uses the same renderer: this is the most intricate code in
/// either app, and two copies of it would be fixed once and broken twice.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb, TargetPlatform;
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

import 'src/avatar_config.dart';
import 'src/avatar_html.dart';

export 'src/avatar_config.dart';

class AvatarView extends StatefulWidget {
  /// URL of the model. For an Embodiment API client this is
  /// `…/api/embodiment/v1/agents/{id}/avatar`.
  final String src;

  /// How to frame it. The Embodiment roster supplies this as `appearance`.
  final AvatarConfig? config;

  /// Where to fetch the shared lip-sync modules from. Defaults to the model's
  /// own origin, which is the runner in every current caller.
  final String? moduleOrigin;

  /// Sent with the model request. The Embodiment API authenticates `/api/*`
  /// and the avatar endpoint is under it, so a client that needs a key must
  /// pass it here — the WebView has no cookie of its own.
  final Map<String, String> headers;

  const AvatarView({
    super.key,
    required this.src,
    this.config,
    this.moduleOrigin,
    this.headers = const {},
  });

  @override
  State<AvatarView> createState() => AvatarViewState();
}

class AvatarViewState extends State<AvatarView> {
  late final WebViewController _ctrl;
  Completer<void> _vrmReady = Completer<void>();

  /// Completes when the current model has finished loading in the WebView.
  /// Awaiting this before playing audio ensures lip sync can start on time.
  Future<void> get vrmReady => _vrmReady.future;

  @override
  void initState() {
    super.initState();
    _ctrl = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.transparent)
      ..addJavaScriptChannel(
        'AvatarBridge',
        onMessageReceived: (_) {
          if (!_vrmReady.isCompleted) _vrmReady.complete();
        },
      );

    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android && Platform.isAndroid) {
      final android = _ctrl.platform as AndroidWebViewController;
      // Enable WebView debugging (inspect via chrome://inspect on desktop).
      AndroidWebViewController.enableDebugging(true);
      // Allow audio/video to play without a user gesture (needed for lipsync audio).
      android.setMediaPlaybackRequiresUserGesture(false);
    }

    _ctrl.loadHtmlString(
      buildAvatarHtml(
        src: widget.src,
        config: widget.config,
        moduleOrigin: widget.moduleOrigin,
        headers: widget.headers,
      ),
      baseUrl: 'http://localhost/',
    );
  }

  /// Called after audio playback starts for each chunk.
  /// [visemes] may be empty — the WebView falls back to a simple animation.
  Future<void> applyLipSync(List<dynamic> visemes) async {
    if (!mounted) return;
    final json = jsonEncode(visemes);
    await _ctrl.runJavaScript('window._queueLipSync && window._queueLipSync($json)');
  }

  @override
  void didUpdateWidget(AvatarView old) {
    super.didUpdateWidget(old);
    // Reuse the live WebView — just swap the model, skipping a full HTML reload.
    if (widget.src != old.src) {
      _vrmReady = Completer<void>(); // fresh gate for the new model
      final srcEsc = jsonEncode(widget.src);
      _ctrl.runJavaScript('window.loadModel && window.loadModel($srcEsc)');
    }
  }

  @override
  Widget build(BuildContext context) => WebViewWidget(controller: _ctrl);
}
