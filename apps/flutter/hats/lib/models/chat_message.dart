enum MessageSender { human, agent }

class ChatMessage {
  final String text;
  final MessageSender sender;
  final String? agentName;
  final DateTime timestamp;

  ChatMessage({
    required this.text,
    required this.sender,
    this.agentName,
    DateTime? timestamp,
  }) : timestamp = timestamp ?? DateTime.now();
}
