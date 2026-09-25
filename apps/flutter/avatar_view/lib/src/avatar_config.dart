/// How to frame an avatar model.
///
/// Mirrors the runner's avatar catalogue, and the `appearance` block the
/// Embodiment API puts on every agent in the roster. Without it a client can
/// download an 18 MB model and still have no idea where to put the camera.
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
    this.name = '',
    this.file = '',
    this.cameraX = 0,
    this.cameraY = 1.65,
    this.cameraZ = 0.5,
    this.rotateX = 0,
    this.rotateY = 0,
    this.rotateZ = 0,
    this.fov = 50.0,
    this.scale = 1.0,
  });

  /// Reads either a catalogue entry or an Embodiment `appearance` block — the
  /// two carry the same fields, because one is the source of the other.
  factory AvatarConfig.fromJson(Map<String, dynamic> j) {
    final cam = (j['camera'] as List<dynamic>?) ?? const [0, 1.65, 0.5];
    final rot = (j['rotate'] as List<dynamic>?) ?? const [0, 0, 0];
    double at(List<dynamic> list, int i, double fallback) =>
        i < list.length && list[i] is num ? (list[i] as num).toDouble() : fallback;

    return AvatarConfig(
      name: j['name'] as String? ?? '',
      file: j['file'] as String? ?? '',
      cameraX: at(cam, 0, 0),
      cameraY: at(cam, 1, 1.65),
      cameraZ: at(cam, 2, 0.5),
      rotateX: at(rot, 0, 0),
      rotateY: at(rot, 1, 0),
      rotateZ: at(rot, 2, 0),
      fov: (j['fov'] as num?)?.toDouble() ?? 50.0,
      scale: (j['scale'] as num?)?.toDouble() ?? 1.0,
    );
  }
}
