import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'providers/app_state.dart';
import 'screens/splash_screen.dart';
import 'screens/qr_scan_screen.dart';
import 'screens/project_select_screen.dart';
import 'screens/home_screen.dart';
import 'screens/kanban_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    ChangeNotifierProvider(
      create: (_) => AppState(),
      child: const HatsApp(),
    ),
  );
}

class HatsApp extends StatelessWidget {
  const HatsApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'HATS',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF1A1A2E),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
      ),
      routes: {
        '/': (_) => const SplashScreen(),
        '/qr': (_) => const QrScanScreen(),
        '/projects': (_) => const ProjectSelectScreen(),
        '/home': (_) => const HomeScreen(),
        '/kanban': (_) => const KanbanScreen(),
      },
      initialRoute: '/',
    );
  }
}
