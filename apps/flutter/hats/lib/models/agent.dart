class Agent {
  final String name;
  final List<String> hatType;
  final String state;
  final String activity;
  final String? talkingTo;
  final String? avatar;
  final String? model;
  final String? provider;
  final String? specialisation;
  final String? voice;
  final String? speakerName;
  final String? background;

  const Agent({
    required this.name,
    required this.hatType,
    required this.state,
    required this.activity,
    this.talkingTo,
    this.avatar,
    this.model,
    this.provider,
    this.specialisation,
    this.voice,
    this.speakerName,
    this.background,
  });

  factory Agent.fromJson(Map<String, dynamic> j) => Agent(
        name: j['name'] as String,
        hatType: (j['hatType'] as List<dynamic>?)?.cast<String>() ?? [],
        state: j['state'] as String? ?? 'idle',
        activity: j['activity'] as String? ?? '',
        talkingTo: j['talkingTo'] as String?,
        avatar: j['avatar'] as String?,
        model: j['model'] as String?,
        provider: j['provider'] as String?,
        specialisation: j['specialisation'] as String?,
        voice: j['voice'] as String?,
        speakerName: j['speakerName'] as String?,
        background: j['background'] as String?,
      );

  bool get isBusy => state == 'busy' || talkingTo != null;
}
