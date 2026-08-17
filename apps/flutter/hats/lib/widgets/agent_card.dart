import 'package:flutter/material.dart';
import 'package:model_viewer_plus/model_viewer_plus.dart';
import '../models/agent.dart';

class AgentCard extends StatelessWidget {
  final Agent agent;
  final String serverUrl;

  const AgentCard({super.key, required this.agent, required this.serverUrl});

  Color _hatColor(String hat) {
    switch (hat.toLowerCase()) {
      case 'white': return Colors.white;
      case 'red': return Colors.red;
      case 'black': return Colors.grey[850]!;
      case 'yellow': return Colors.amber;
      case 'green': return Colors.green;
      case 'blue': return Colors.blue;
      default: return Colors.purple;
    }
  }

  @override
  Widget build(BuildContext context) {
    final avatarFile = agent.avatar;
    final hatLabel = agent.hatType.isNotEmpty ? agent.hatType.first : '';
    final hatColor = _hatColor(hatLabel);

    return Column(
      children: [
        // 3-D avatar or placeholder
        Expanded(
          child: avatarFile != null
              ? ModelViewer(
                  src: '$serverUrl/avatars/$avatarFile',
                  autoRotate: false,
                  cameraControls: true,
                  backgroundColor: Colors.transparent,
                )
              : Center(
                  child: CircleAvatar(
                    radius: 80,
                    backgroundColor: hatColor.withOpacity(0.2),
                    child: Text(
                      agent.name.isNotEmpty ? agent.name[0].toUpperCase() : '?',
                      style: TextStyle(fontSize: 64, color: hatColor),
                    ),
                  ),
                ),
        ),

        // Name + hat chip + status
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                agent.name,
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
              ),
              if (hatLabel.isNotEmpty) ...[
                const SizedBox(width: 10),
                Chip(
                  label: Text(hatLabel, style: const TextStyle(fontSize: 11)),
                  backgroundColor: hatColor.withOpacity(0.2),
                  side: BorderSide(color: hatColor),
                  padding: EdgeInsets.zero,
                  labelPadding: const EdgeInsets.symmetric(horizontal: 6),
                ),
              ],
            ],
          ),
        ),

        // Activity / state
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                agent.isBusy ? Icons.circle : Icons.circle_outlined,
                size: 10,
                color: agent.isBusy ? Colors.green : Colors.grey,
              ),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  agent.activity.isEmpty ? agent.state : agent.activity,
                  style: const TextStyle(fontSize: 13, color: Colors.grey),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
