import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:provider/provider.dart';
import '../providers/app_state.dart';
import '../services/api_service.dart';

class QrScanScreen extends StatefulWidget {
  const QrScanScreen({super.key});

  @override
  State<QrScanScreen> createState() => _QrScanScreenState();
}

class _QrScanScreenState extends State<QrScanScreen> {
  final MobileScannerController _scanner = MobileScannerController();
  bool _processing = false;
  String? _error;

  @override
  void dispose() {
    _scanner.dispose();
    super.dispose();
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_processing) return;
    final url = capture.barcodes.firstOrNull?.rawValue;
    if (url == null || !url.contains('/api/auth/pair/')) return;

    setState(() { _processing = true; _error = null; });
    _scanner.stop();

    try {
      final data = await ApiService.redeemPairUrl(url);
      final apiKey = data['apiKey'] as String?;
      final username = data['username'] as String?;
      if (apiKey == null || username == null) throw Exception('Invalid server response');

      final uri = Uri.parse(url);
      final serverUrl = '${uri.scheme}://${uri.host}:${uri.port}';

      if (!mounted) return;
      await context.read<AppState>().setCredentials(
            url: serverUrl,
            key: apiKey,
            user: username,
          );
      if (!mounted) return;
      Navigator.pushReplacementNamed(context, '/projects');
    } catch (e) {
      setState(() { _error = e.toString(); _processing = false; });
      _scanner.start();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scan QR Code')),
      body: Stack(
        children: [
          MobileScanner(controller: _scanner, onDetect: _onDetect),
          if (_processing)
            const ColoredBox(
              color: Color(0xAA000000),
              child: Center(child: CircularProgressIndicator()),
            ),
          if (_error != null)
            Positioned(
              bottom: 40,
              left: 24,
              right: 24,
              child: Card(
                color: Colors.red[900],
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(_error!, style: const TextStyle(color: Colors.white)),
                ),
              ),
            ),
          Positioned(
            top: 40,
            left: 0,
            right: 0,
            child: Center(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                decoration: BoxDecoration(
                  color: Colors.black54,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Text(
                  'Scan the QR code from Settings → Users → Pair mobile',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
