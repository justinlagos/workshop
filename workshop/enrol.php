<?php
// Fallback for cPanel shared hosting without Node: POST JSON here from the same form.
// Configure ADMIN_EMAIL below. Uses PHP mail(). For better deliverability use SMTP plugin or Resend webhook.
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['ok'=>false,'error'=>'Method not allowed']); exit; }

$ADMIN_EMAIL = 'justin@motionplaylabs.com';
$MAX_SEATS = 8;
$dataFile = __DIR__ . '/../data/enrolments.json';
@mkdir(dirname($dataFile), 0777, true);

$in = json_decode(file_get_contents('php://input'), true) ?: [];
if (!empty($in['company_website'])) { http_response_code(400); echo json_encode(['ok'=>false,'error'=>'spam detected']); exit; }
$fullName = trim($in['fullName'] ?? '');
$email = trim($in['email'] ?? '');
$country = trim($in['country'] ?? '');
$whatsapp = trim($in['whatsapp'] ?? '');
$ai = trim($in['aiExperience'] ?? '');
$claude = trim($in['claudePlan'] ?? '');
$goal = trim($in['projectGoal'] ?? '');
$currency = (($in['currency'] ?? 'GBP') === 'NGN') ? 'NGN' : 'GBP';

$errs = [];
if (strlen($fullName) < 2) $errs[] = 'Full name is required';
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) $errs[] = 'Valid email is required';
if (!$country) $errs[] = 'Country is required';
if (!in_array($ai, ['Beginner','Basic','Intermediate'])) $errs[] = 'AI experience is required';
if (!in_array($claude, ['Yes','No','Not sure'])) $errs[] = 'Claude subscription answer is required';
if (strlen($goal) < 10 || strlen($goal) > 300) $errs[] = 'Project goal must be 10–300 characters';
if ($errs) { http_response_code(400); echo json_encode(['ok'=>false,'error'=>$errs[0],'errors'=>$errs]); exit; }

$rows = file_exists($dataFile) ? (json_decode(file_get_contents($dataFile), true) ?: []) : [];
foreach ($rows as $r) { if (strtolower($r['email']) === strtolower($email)) { http_response_code(409); echo json_encode(['ok'=>false,'error'=>'This email already applied.']); exit; } }
if (count($rows) >= $MAX_SEATS) { http_response_code(409); echo json_encode(['ok'=>false,'error'=>'Cohort 01 is full (8 seats).']); exit; }

$ref = 'TBS-' . strtoupper(substr(base_convert(time(), 10, 36), -6));
$rows[] = ['reference'=>$ref,'fullName'=>$fullName,'email'=>$email,'country'=>$country,'whatsapp'=>$whatsapp,'aiExperience'=>$ai,'claudePlan'=>$claude,'projectGoal'=>$goal,'currency'=>$currency,'createdAt'=>gmdate('c')];
file_put_contents($dataFile, json_encode($rows, JSON_PRETTY_PRINT));

$fee = $currency === 'NGN' ? '₦85,000 NGN' : '£50 GBP';
$subj = "Your Build Session application $ref — what happens next";
$msg = "Hi $fullName,\n\nThanks for applying for The Build Session Founding Cohort 01 (Sat 24 Oct 2026, 2–5pm, online).\nRef: $ref. Fee: $fee.\n\nJustin reviews every application and replies within 48h with onboarding + payment details.\n\n— Justin Ukaegbu, MotionPlay Labs\nhttps://motionplaylabs.com/workshop";
@mail($email, $subj, $msg, "From: MotionPlay Labs <hello@motionplaylabs.com>\r\nReply-To: justin@motionplaylabs.com");
@mail($ADMIN_EMAIL, "New application $ref — $fullName", "Name: $fullName\nEmail: $email\nCountry: $country\nWhatsApp: $whatsapp\nAI: $ai\nClaude: $claude\nFee: $fee\nGoal: $goal", "From: Workshop <hello@motionplaylabs.com>");

echo json_encode(['ok'=>true,'reference'=>$ref,'emailSent'=>true,'remaining'=>max(0,$MAX_SEATS-count($rows))]);
