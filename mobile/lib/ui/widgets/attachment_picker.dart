import 'dart:io';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../util/attachment_limits.dart';

/// 選ばれたファイル 1 件。
class PickedFile {
  const PickedFile({required this.fileName, required this.contentType, required this.bytes});

  final String fileName;
  final String contentType;
  final Uint8List bytes;
}

/// 権限が拒否されている（設定への導線を出す）。
class PermissionDeniedException implements Exception {
  const PermissionDeniedException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// 写真ライブラリ・カメラ・ファイルからの添付（mobile-shell spec「iOS からの添付」）。
///
/// 権限が拒否されている場合はクラッシュさせず、[PermissionDeniedException] を投げる。
/// テストは実装を差し替えるため、抽象として定義する。
abstract class AttachmentPicker {
  factory AttachmentPicker({ImagePicker? imagePicker}) = SystemAttachmentPicker;

  Future<PickedFile?> pickFromLibrary();
  Future<PickedFile?> pickFromCamera();
  Future<List<PickedFile>> pickFiles();
}

/// iOS の写真ライブラリ・カメラ・ファイルアプリを使う実装。
class SystemAttachmentPicker implements AttachmentPicker {
  SystemAttachmentPicker({ImagePicker? imagePicker}) : _imagePicker = imagePicker ?? ImagePicker();

  final ImagePicker _imagePicker;

  @override
  Future<PickedFile?> pickFromLibrary() =>
      _pickImage(ImageSource.gallery, Permission.photos, '写真ライブラリ');

  @override
  Future<PickedFile?> pickFromCamera() =>
      _pickImage(ImageSource.camera, Permission.camera, 'カメラ');

  @override
  Future<List<PickedFile>> pickFiles() async {
    final result = await FilePicker.pickFiles(allowMultiple: true, withData: true);
    if (result == null) return const [];

    final picked = <PickedFile>[];
    for (final file in result.files) {
      final bytes = file.bytes ?? (file.path == null ? null : await File(file.path!).readAsBytes());
      if (bytes == null) continue;
      picked.add(
        PickedFile(
          fileName: file.name,
          contentType: contentTypeForFileName(file.name),
          bytes: bytes,
        ),
      );
    }
    return picked;
  }

  Future<PickedFile?> _pickImage(ImageSource source, Permission permission, String label) async {
    final status = await permission.request();
    // iOS の「選択した写真のみ」は limited で返るが、選択は行える。
    if (status.isPermanentlyDenied || status.isDenied || status.isRestricted) {
      throw PermissionDeniedException('$labelへのアクセスが許可されていません');
    }

    final image = await _imagePicker.pickImage(source: source);
    if (image == null) return null;
    final bytes = await image.readAsBytes();
    final fileName = image.name.isEmpty ? 'image.jpg' : image.name;
    return PickedFile(
      fileName: fileName,
      contentType: image.mimeType ?? contentTypeForFileName(fileName),
      bytes: bytes,
    );
  }
}

/// 添付元を選ぶシート。
Future<AttachmentSource?> showAttachmentSourceSheet(BuildContext context) {
  return showModalBottomSheet<AttachmentSource>(
    context: context,
    builder: (context) => SafeArea(
      child: Wrap(
        children: [
          ListTile(
            leading: const Icon(Icons.photo_library_outlined),
            title: const Text('写真ライブラリ'),
            onTap: () => Navigator.of(context).pop(AttachmentSource.library),
          ),
          ListTile(
            leading: const Icon(Icons.photo_camera_outlined),
            title: const Text('カメラ'),
            onTap: () => Navigator.of(context).pop(AttachmentSource.camera),
          ),
          ListTile(
            leading: const Icon(Icons.attach_file),
            title: const Text('ファイル'),
            onTap: () => Navigator.of(context).pop(AttachmentSource.files),
          ),
        ],
      ),
    ),
  );
}

enum AttachmentSource { library, camera, files }

/// 権限が無いときの案内。設定アプリへ誘導する。
Future<void> showPermissionDialog(BuildContext context, String message) async {
  final open = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('権限が必要です'),
      content: Text('$message\n設定アプリから許可してください。'),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('閉じる')),
        TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('設定を開く')),
      ],
    ),
  );
  if (open ?? false) await openAppSettings();
}
