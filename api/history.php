<?php
header('Cache-Control: no-store');

$user = $_GET['user'] ?? '0';
$dir = __DIR__ . '/' . $user;

if (isset($_POST['files'])) {
	$files = array_unique($_POST['files']);
	foreach ($files as $file) {
		unlink($dir . '/' . $file);
	}
	header('Location: ' . strtok($_SERVER['REQUEST_URI'], '?'));
	exit();
}

$historyFiles = glob($dir . '/presets_[0-9]*.json');

$currentFile = $dir . '/presets.json';

// Charger les versions actuelles
$currentPresets = json_decode(@file_get_contents($currentFile), true);
$currentVersions = [];

if (is_array($currentPresets)) {
	foreach ($currentPresets as $preset) {
		if (isset($preset['name'], $preset['value'])) {
			$currentVersions[$preset['name']] = $preset['value'];
		}
	}
}

$rawHistory = [];
$retainedEntries = [];
$seenValues = [];

// Fonction pour extraire la date à partir du nom de fichier
function extractDate(string $filename): ?string {
	if (preg_match('/presets_(\d{14})\.json$/', $filename, $matches)) {
		$date = DateTime::createFromFormat('YmdHis', $matches[1]);
		return $date ? $date->format('Y-m-d H:i:s') : null;
	}
	return null;
}

// Étape 1 : collecte des données
foreach ($historyFiles as $filePath) {
	$filename = basename($filePath);
	$date = extractDate($filename);
	if (!$date) continue;
	$presets = json_decode(@file_get_contents($filePath), true);
	if (!is_array($presets)) continue;
	foreach ($presets as ['name' => $name, 'value' => $value]) {
		if (isset($currentVersions[$name]) && $currentVersions[$name] === $value) {
			continue;
		}
		$rawHistory[$name][] = compact('date', 'value', 'filename');
	}
}

// Étape 2 : sélection et tri
foreach ($rawHistory as $name => $versions) {
	// Trier par date croissante pour garder la première occurrence
	//usort($versions, fn($a, $b) => $a['date'] <=> $b['date']);
	usort($versions, fn($a, $b) => $b['date'] <=> $a['date']);
	foreach ($versions as $v) {
		if (!isset($seenValues[$name][$v['value']])) {
			$seenValues[$name][$v['value']] = true;
			$retainedEntries[$name][] = [
				'date' => $v['date'],
				'value' => $v['value'],
				'file' => $v['filename']
			];
		}
	}
	usort($retainedEntries[$name], fn($a, $b) => $b['date'] <=> $a['date']);
}

// Étape 3 : suppression des fichiers inutiles
$usedFiles = array_unique(
	array_map(fn($e) => $e['file'], array_merge(...array_values($retainedEntries)))
);

foreach ($historyFiles as $filePath) {
	$filename = basename($filePath);
	if (!in_array($filename, $usedFiles, true)) {
		unlink($filePath);
	}
}

?>

<!DOCTYPE html>
<html lang="fr">
<head>
<meta name="viewport" content="width=device-width">
<link rel="icon" type="image/svg+xml" href="favicon.svg"/>
<title>Historique des morceaux</title>
<style>
body {
	max-width:16em;
	margin:1em auto;
	font:400 1.2em/1.4 sans-serif;
}
h1 {
	font-size:1.3em;
	text-align:center;
}
button {
	width:100%;
	padding:.5em;
	margin:.5em 0 1em;
	font-size: inherit;
}
p {
	text-align:center;
}
fieldset {
	margin:.5em 0;
	border-radius:.3em;
	border:1px solid #555;
}
legend {
	font-weight:600;
}
ul {
	padding:0;
	margin:0;
}
li {
	display:flex;
	list-style:none;
	justify-content:space-between;
}
</style>
</head>
<body>
<h1>Historique des morceaux</h1>
<?php if (count($retainedEntries) === 0): ?>
<p>Aucun historique présent</p>
<?php else: ?>
<button form="versions" disabled>Supprimer des entrées</button>
<form id="versions" method="post">
	<?php foreach($retainedEntries as $name => $versions): ?>
	<fieldset>
		<legend><?php echo $name ?></legend>
		<ul>
			<?php foreach($versions as $version): ?>
			<li>
				<label>
					<input type="checkbox" name="files[]" value="<?php echo $version['file'] ?>"> <?php echo $version['date'] ?>
				</label>
				<a href="../?title=<?php echo $name ?>&set=<?php echo $version['value'] ?>">Voir</a>
			</li>
			<?php endforeach ?>
		</ul>
	</fieldset>
	<?php endforeach ?>
</form>
<script>
document.addEventListener('DOMContentLoaded', () => {
	const form = document.querySelector('form');
	const button = document.querySelector('button');
	form.addEventListener('change', (event) => {
		const target = event.target;
		if (target.matches('input[type="checkbox"][name="files[]"]')) {
			const selectedValue = target.value;
			const isChecked = target.checked;
			const checkboxes = form.querySelectorAll('input[type="checkbox"][name="files[]"]');
			checkboxes.forEach(other => {
				if (other.value === selectedValue) {
					other.checked = isChecked;
				}
			});
			const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
			if (checkedCount > 0) {
				button.textContent = `Supprimer ${checkedCount} entrée${checkedCount > 1 ? 's' : ''}`;
				button.disabled = false;
			} else {
				button.textContent = 'Supprimer des entrées';
				button.disabled = true;
			}
		}
	});
});
</script>
<?php endif ?>
</body>
</html>