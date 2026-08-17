import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/project.dart';
import '../providers/app_state.dart';

class ProjectSelectScreen extends StatefulWidget {
  const ProjectSelectScreen({super.key});

  @override
  State<ProjectSelectScreen> createState() => _ProjectSelectScreenState();
}

class _ProjectSelectScreenState extends State<ProjectSelectScreen> {
  List<Project>? _projects;
  String? _error;
  bool _loading = true;
  String? _switching;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final projects = await context.read<AppState>().api.getProjects();
      if (mounted) setState(() { _projects = projects; _loading = false; });
    } catch (e) {
      if (mounted) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _select(String id) async {
    setState(() => _switching = id);
    try {
      await context.read<AppState>().setProject(id);
      if (mounted) Navigator.pushReplacementNamed(context, '/home');
    } catch (e) {
      if (mounted) setState(() { _error = e.toString(); _switching = null; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Choose Project')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)))
              : _projects!.isEmpty
                  ? const Center(
                      child: Padding(
                        padding: EdgeInsets.all(32),
                        child: Text(
                          'No projects found.\nUse the web app to set up a project first.',
                          textAlign: TextAlign.center,
                          style: TextStyle(fontSize: 16),
                        ),
                      ),
                    )
                  : ListView.builder(
                      itemCount: _projects!.length,
                      itemBuilder: (ctx, i) {
                        final p = _projects![i];
                        return ListTile(
                          title: Text(p.id),
                          subtitle: Text(p.dir, maxLines: 1, overflow: TextOverflow.ellipsis),
                          trailing: _switching == p.id
                              ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                              : p.active
                                  ? const Icon(Icons.check_circle, color: Colors.green)
                                  : null,
                          onTap: _switching == null ? () => _select(p.id) : null,
                        );
                      },
                    ),
    );
  }
}
