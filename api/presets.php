<?php
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: PUT, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-KEY');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
	http_response_code(204);
	exit;
}

$headers = getallheaders();
$key     = $_SERVER['HTTP_X_API_KEY'] ?? '';

if ($key !== 'cestleszurbamateurs') {
	http_response_code(403);
	exit(json_encode(['error' => 'Unauthorized']));
}

$user     = $_GET['user'] ?? null;
$filename = $_GET['filename'] ?? null;

if ($user === null || $filename === null) {
	http_response_code(400);
	exit('Missing parameters.');
}

$user     = basename($user);
$filename = basename($filename);

if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
	$userDir     = __DIR__ . "/../data/presets/$user";
	$userPath    = "$userDir/$filename";
	$defaultPath = __DIR__ . "/../data/presets/$filename";
	$input       = file_get_contents('php://input');

	if (file_exists($userPath)) {
		$info   = pathinfo($filename);
		$backup = sprintf("%s/%s_%s.%s", $userDir, $info['filename'], date('YmdHis'), $info['extension'] ?? '');
		rename($userPath, $backup);
	} elseif (!is_dir($userDir)) {
		mkdir($userDir, 0755, true);
	}

	file_put_contents($userPath, $input, LOCK_EX);

	header('Content-Type: application/json');
	header('Cache-Control: no-cache, must-revalidate');
	header('ETag: "' . md5_file($userPath) . '"');
	header('Last-Modified: ' . gmdate('D, d M Y H:i:s', filemtime($userPath)) . ' GMT');

	readfile($userPath);
	exit;
}

http_response_code(405);
exit('Method not allowed.');
