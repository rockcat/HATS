class AvatarConfig {
  final String name;
  final String file;
  final double cameraX;
  final double cameraY;
  final double cameraZ;
  final double rotateX;
  final double rotateY;
  final double rotateZ;
  final double fov;
  final double scale;

  const AvatarConfig({
    required this.name,
    required this.file,
    required this.cameraX,
    required this.cameraY,
    required this.cameraZ,
    required this.rotateX,
    required this.rotateY,
    required this.rotateZ,
    required this.fov,
    required this.scale,
  });

  factory AvatarConfig.fromJson(Map<String, dynamic> j) {
    final cam = (j['camera'] as List<dynamic>?) ?? [0, 1.65, 0.5];
    final rot = (j['rotate'] as List<dynamic>?) ?? [0, 0, 0];
    return AvatarConfig(
      name: j['name'] as String? ?? '',
      file: j['file'] as String? ?? '',
      cameraX: (cam[0] as num).toDouble(),
      cameraY: (cam[1] as num).toDouble(),
      cameraZ: (cam[2] as num).toDouble(),
      rotateX: (rot[0] as num).toDouble(),
      rotateY: (rot[1] as num).toDouble(),
      rotateZ: (rot[2] as num).toDouble(),
      fov: (j['fov'] as num?)?.toDouble() ?? 50.0,
      scale: (j['scale'] as num?)?.toDouble() ?? 1.0,
    );
  }

  /// model-viewer cameraTarget: the point in model space the camera looks at.
  String get cameraTarget => '${cameraX}m ${cameraY}m 0m';

  /// model-viewer cameraOrbit: theta=0° (front), phi=90° (horizontal), radius from config.
  String get cameraOrbit => '0deg 90deg ${(cameraZ * 0.5).toStringAsFixed(2)}m';

  /// model-viewer fieldOfView.
  String get fieldOfView => '${fov}deg';

  /// model-viewer orientation: rotates the model so it faces the camera.
  String get orientation => '${rotateX}deg ${rotateY}deg ${rotateZ}deg';
}
