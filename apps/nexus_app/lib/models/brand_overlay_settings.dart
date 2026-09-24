class BrandOverlaySettings {
  final bool logoEnabled;
  final String logoPosition;
  final bool contactBarEnabled;
  final bool showWhatsapp;
  final bool showInstagram;
  final bool showWebsite;
  final String whatsapp;
  final String instagram;
  final String website;
  final String contactPosition;
  final bool preferLetterboxSafeZone;
  final bool avoidSubtitlesAndFaces;

  const BrandOverlaySettings({
    this.logoEnabled = true,
    this.logoPosition = 'top-safe-area',
    this.contactBarEnabled = true,
    this.showWhatsapp = true,
    this.showInstagram = false,
    this.showWebsite = false,
    this.whatsapp = '',
    this.instagram = '',
    this.website = '',
    this.contactPosition = 'bottom-safe-area',
    this.preferLetterboxSafeZone = true,
    this.avoidSubtitlesAndFaces = true,
  });

  BrandOverlaySettings copyWith({
    bool? logoEnabled,
    String? logoPosition,
    bool? contactBarEnabled,
    bool? showWhatsapp,
    bool? showInstagram,
    bool? showWebsite,
    String? whatsapp,
    String? instagram,
    String? website,
    String? contactPosition,
    bool? preferLetterboxSafeZone,
    bool? avoidSubtitlesAndFaces,
  }) {
    return BrandOverlaySettings(
      logoEnabled: logoEnabled ?? this.logoEnabled,
      logoPosition: logoPosition ?? this.logoPosition,
      contactBarEnabled: contactBarEnabled ?? this.contactBarEnabled,
      showWhatsapp: showWhatsapp ?? this.showWhatsapp,
      showInstagram: showInstagram ?? this.showInstagram,
      showWebsite: showWebsite ?? this.showWebsite,
      whatsapp: whatsapp ?? this.whatsapp,
      instagram: instagram ?? this.instagram,
      website: website ?? this.website,
      contactPosition: contactPosition ?? this.contactPosition,
      preferLetterboxSafeZone: preferLetterboxSafeZone ?? this.preferLetterboxSafeZone,
      avoidSubtitlesAndFaces: avoidSubtitlesAndFaces ?? this.avoidSubtitlesAndFaces,
    );
  }

  Map<String, dynamic> toJson() => {
        'logoEnabled': logoEnabled,
        'logoPosition': logoPosition,
        'contactBarEnabled': contactBarEnabled,
        'showWhatsapp': showWhatsapp,
        'showInstagram': showInstagram,
        'showWebsite': showWebsite,
        'whatsapp': whatsapp,
        'instagram': instagram,
        'website': website,
        'contactPosition': contactPosition,
        'preferLetterboxSafeZone': preferLetterboxSafeZone,
        'avoidSubtitlesAndFaces': avoidSubtitlesAndFaces,
      };

  factory BrandOverlaySettings.fromJson(Map<String, dynamic> json) {
    return BrandOverlaySettings(
      logoEnabled: json['logoEnabled'] != false,
      logoPosition: (json['logoPosition'] ?? 'top-safe-area').toString(),
      contactBarEnabled: json['contactBarEnabled'] != false,
      showWhatsapp: json['showWhatsapp'] != false,
      showInstagram: json['showInstagram'] == true,
      showWebsite: json['showWebsite'] == true,
      whatsapp: (json['whatsapp'] ?? '').toString(),
      instagram: (json['instagram'] ?? '').toString(),
      website: (json['website'] ?? '').toString(),
      contactPosition: (json['contactPosition'] ?? 'bottom-safe-area').toString(),
      preferLetterboxSafeZone: json['preferLetterboxSafeZone'] != false,
      avoidSubtitlesAndFaces: json['avoidSubtitlesAndFaces'] != false,
    );
  }
}
