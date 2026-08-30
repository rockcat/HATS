class Project {
  final String id;
  final String dir;
  final bool active;

  const Project({required this.id, required this.dir, required this.active});

  factory Project.fromJson(Map<String, dynamic> j) => Project(
        id: j['id'] as String,
        dir: j['dir'] as String,
        active: j['active'] as bool? ?? false,
      );
}
