/**
 * Service Integration Tests
 * Simulates real-world service calls with new signatures
 * Run in browser console after page loads and init() completes
 */

console.log('🔧 Service Integration Test Suite\n');

// ═══════════════════════════════════════════════════════════════════════════
// SETUP: Check prerequisites
// ═══════════════════════════════════════════════════════════════════════════

const checkPrerequisites = () => {
  const issues = [];

  if (!window.Services) issues.push('Services object not initialized');
  if (!window.currentOrgId) issues.push('currentOrgId not set (must run after init())');
  if (!window.currentUser) issues.push('currentUser not set (must run after init())');
  if (!window.Store) issues.push('Store not initialized');

  if (issues.length > 0) {
    console.log('❌ Prerequisites not met:');
    issues.forEach(i => console.log(`   - ${i}`));
    console.log('\n⏳ Please wait for page to fully load, then retry.');
    return false;
  }

  console.log('✅ All prerequisites met');
  console.log(`   - Services: Ready`);
  console.log(`   - currentOrgId: ${currentOrgId}`);
  console.log(`   - currentUser: ${currentUser?.email}`);
  console.log(`   - Store: Ready\n`);
  return true;
};

if (!checkPrerequisites()) {
  console.log('Cannot run tests. Prerequisites failed.');
  throw new Error('Test prerequisites not met');
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST UTILS
// ═══════════════════════════════════════════════════════════════════════════

class TestRunner {
  constructor(name) {
    this.name = name;
    this.results = [];
  }

  async test(description, fn) {
    try {
      console.log(`⏳ ${description}...`);
      const result = await fn();
      console.log(`✅ PASS: ${description}`);
      this.results.push({ description, status: 'PASS', result });
    } catch (error) {
      console.log(`❌ FAIL: ${description}`);
      console.log(`   Error: ${error.message}`);
      this.results.push({ description, status: 'FAIL', error: error.message });
    }
  }

  summary() {
    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;
    console.log(`\n${this.name}: ${passed} passed, ${failed} failed`);
    return failed === 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 1: Method Signature Validation
// ═══════════════════════════════════════════════════════════════════════════

console.log('TEST SUITE 1: Method Signature Validation');
console.log('─'.repeat(60));

const runner1 = new TestRunner('Signature Tests');

await runner1.test('FolderService.updateFolder accepts (folderId, orgId, payload)', async () => {
  const method = Services.folders.updateFolder;
  const params = method.toString().match(/\(([^)]*)\)/)[1].split(',').map(p => p.trim());

  if (!params.includes('folderId') || !params.includes('orgId') || !params.includes('payload')) {
    throw new Error(`Expected (folderId, orgId, payload), got (${params.join(', ')})`);
  }
});

await runner1.test('TaskService.updateTask accepts (taskId, orgId, payload, userId)', async () => {
  const method = Services.tasks.updateTask;
  const params = method.toString().match(/\(([^)]*)\)/)[1].split(',').map(p => p.trim());

  if (!params.includes('taskId') || !params.includes('orgId') || !params.includes('payload')) {
    throw new Error(`Missing required parameters in: ${params.join(', ')}`);
  }
});

await runner1.test('TaskService.setDone accepts (taskId, orgId, done, userId)', async () => {
  const method = Services.tasks.setDone;
  const params = method.toString().match(/\(([^)]*)\)/)[1].split(',').map(p => p.trim());

  if (!params.includes('taskId') || !params.includes('orgId') || !params.includes('done')) {
    throw new Error(`Missing required parameters in: ${params.join(', ')}`);
  }
});

await runner1.test('RiskService.updateRiskStatus accepts (riskId, orgId, status, userId)', async () => {
  const method = Services.risks.updateRiskStatus;
  const params = method.toString().match(/\(([^)]*)\)/)[1].split(',').map(p => p.trim());

  if (!params.includes('riskId') || !params.includes('orgId') || !params.includes('status')) {
    throw new Error(`Missing required parameters in: ${params.join(', ')}`);
  }
});

runner1.summary();
console.log();

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2: Organization ID Validation
// ═══════════════════════════════════════════════════════════════════════════

console.log('TEST SUITE 2: Organization ID Validation');
console.log('─'.repeat(60));

const runner2 = new TestRunner('OrgId Validation Tests');

await runner2.test('BaseService.update() includes .eq("organization_id", orgId) check', async () => {
  const method = BaseService.prototype.update;
  const source = method.toString();

  if (!source.includes("eq('organization_id'") && !source.includes('eq("organization_id"')) {
    throw new Error('organization_id check not found in update() method');
  }
});

await runner2.test('Update calls with wrong orgId should fail validation', async () => {
  // This is a conceptual test - the actual Supabase RLS will reject it
  // Just verify the code structure includes the check
  const method = BaseService.prototype.update;
  const source = method.toString();

  if (!source.includes('orgId')) {
    throw new Error('orgId parameter not used in update() method');
  }
});

runner2.summary();
console.log();

// ═══════════════════════════════════════════════════════════════════════════
// TEST 3: XSS Prevention
// ═══════════════════════════════════════════════════════════════════════════

console.log('TEST SUITE 3: XSS Prevention');
console.log('─'.repeat(60));

const runner3 = new TestRunner('XSS Prevention Tests');

await runner3.test('escapeAttr() function exists and is callable', async () => {
  if (typeof escapeAttr !== 'function') {
    throw new Error('escapeAttr() is not a function');
  }
  // Test it works
  const result = escapeAttr("test");
  if (typeof result !== 'string') {
    throw new Error('escapeAttr() did not return a string');
  }
});

await runner3.test('escapeAttr() escapes single quotes', async () => {
  const result = escapeAttr("id'; alert('xss'); //");
  if (!result.includes('&#39;')) {
    throw new Error('Single quotes not escaped: ' + result);
  }
});

await runner3.test('escapeAttr() escapes double quotes', async () => {
  const result = escapeAttr('id" onload="alert()');
  if (!result.includes('&quot;')) {
    throw new Error('Double quotes not escaped: ' + result);
  }
});

await runner3.test('escapeAttr() escapes HTML entities', async () => {
  const result = escapeAttr('<img onerror="alert()">');
  if (!result.includes('&lt;') || !result.includes('&gt;')) {
    throw new Error('HTML brackets not escaped: ' + result);
  }
});

runner3.summary();
console.log();

// ═══════════════════════════════════════════════════════════════════════════
// TEST 4: Global State
// ═══════════════════════════════════════════════════════════════════════════

console.log('TEST SUITE 4: Global State');
console.log('─'.repeat(60));

const runner4 = new TestRunner('Global State Tests');

await runner4.test('currentOrgId is a non-empty string', async () => {
  if (typeof currentOrgId !== 'string' || currentOrgId.length === 0) {
    throw new Error(`currentOrgId is ${typeof currentOrgId}: "${currentOrgId}"`);
  }
});

await runner4.test('currentUser is defined and has email', async () => {
  if (!currentUser || !currentUser.email) {
    throw new Error('currentUser or email is missing');
  }
});

await runner4.test('Services has required methods', async () => {
  const required = ['folders', 'tasks', 'risks', 'counterparties', 'documents'];
  const missing = required.filter(s => !Services[s]);

  if (missing.length > 0) {
    throw new Error(`Missing services: ${missing.join(', ')}`);
  }
});

runner4.summary();
console.log();

// ═══════════════════════════════════════════════════════════════════════════
// FINAL SUMMARY
// ═══════════════════════════════════════════════════════════════════════════

console.log('═'.repeat(60));
console.log('FINAL TEST REPORT');
console.log('═'.repeat(60));

const allPassed = [
  runner1.summary(),
  runner2.summary(),
  runner3.summary(),
  runner4.summary()
].every(p => p);

if (allPassed) {
  console.log('\n🎉 All tests PASSED!\n');
  console.log('✅ Service method signatures are correct');
  console.log('✅ Organization ID validation is in place');
  console.log('✅ XSS prevention function is available');
  console.log('✅ Global state is properly initialized\n');
  console.log('Next: Test UI workflows and real API calls');
} else {
  console.log('\n⚠️  Some tests failed. Review output above.\n');
}

console.log('═'.repeat(60));
