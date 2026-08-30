class Ticket {
  final String id;
  final String title;
  final String column;
  final String? assignedTo;
  final String? description;

  const Ticket({
    required this.id,
    required this.title,
    required this.column,
    this.assignedTo,
    this.description,
  });

  factory Ticket.fromJson(Map<String, dynamic> j) => Ticket(
        id: j['id'] as String,
        title: j['title'] as String? ?? '',
        column: j['column'] as String? ?? 'backlog',
        assignedTo: j['assignedTo'] as String?,
        description: j['description'] as String?,
      );
}
