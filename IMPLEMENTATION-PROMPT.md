# IMPLEMENTATION PROMPT — Start Here

**Purpose:** Use this prompt to begin implementing the modernization plan  
**Reference Documents:**
- `PHASE6-EXECUTION-PLAN.md` - Overall execution strategy
- `IMPLEMENTATION-GUARDRAIL.md` - Detailed step-by-step guide with code

---

## PROMPT FOR AI ASSISTANT

```
You are implementing the modernization plan for stewardPOS (Persona POS) to bring it to modern standards and production-ready deployment.

**CRITICAL RULES:**
1. Follow IMPLEMENTATION-GUARDRAIL.md EXACTLY - do not skip any steps
2. Work through steps in order (Step 1 → Step 2 → Step 3, etc.)
3. Complete ALL verification checklists before moving to the next step
4. Use the exact code examples provided in IMPLEMENTATION-GUARDRAIL.md
5. Do not proceed to the next step until current step is 100% complete and verified

**CURRENT TASK:**
Start with Step 1: Frontend-Backend API Client (from IMPLEMENTATION-GUARDRAIL.md, Week 1)

**WORKING MODE:**
- Read IMPLEMENTATION-GUARDRAIL.md first
- For each sub-step (1.1, 1.2, etc.):
  - Create/modify the specified files
  - Use the exact code provided in the guardrail
  - Run verification commands
  - Check off verification items
  - Report any issues or deviations
- Only move to next sub-step after current one is verified
- Only move to next step after all sub-steps are complete

**VERIFICATION REQUIREMENTS:**
- Code compiles without errors
- TypeScript types are correct
- Files are created in correct locations
- Dependencies are installed
- Manual testing passes (where applicable)
- All checkboxes in guardrail are checked

**OUTPUT FORMAT:**
After each sub-step, provide:
1. ✅ Status: Complete/In Progress/Blocked
2. Files created/modified: [list]
3. Verification results: [pass/fail for each item]
4. Issues encountered: [if any]
5. Next action: [what to do next]

**REFERENCE FILES:**
- IMPLEMENTATION-GUARDRAIL.md - Your primary guide (follow it exactly)
- PHASE6-EXECUTION-PLAN.md - Overall context and priorities
- All Phase 0-5 documents - Architecture and design decisions

**BEGIN:** Start with Step 1.1: Create API Client Base
```

---

## USAGE INSTRUCTIONS

### For AI Assistant (Cursor/Claude/etc.)

1. **Copy the prompt above** into your AI assistant
2. **Ensure both reference documents are accessible:**
   - `IMPLEMENTATION-GUARDRAIL.md` must be open/accessible
   - `PHASE6-EXECUTION-PLAN.md` for context
3. **Start the implementation** - AI will work through steps systematically

### For Human Developer

1. **Open IMPLEMENTATION-GUARDRAIL.md**
2. **Start at Step 1** (Week 1: Foundation & Integration)
3. **Follow each sub-step** (1.1, 1.2, 1.3, etc.)
4. **Check off items** as you complete them
5. **Verify each step** before moving to the next

---

## STEP-BY-STEP WORKFLOW

### When Starting a New Step:

1. **Read the step** in IMPLEMENTATION-GUARDRAIL.md
2. **Understand the purpose** and acceptance criteria
3. **Review the code examples** provided
4. **Create/modify files** as specified
5. **Run verification commands**
6. **Check off verification items**
7. **Report status** before moving to next sub-step

### Example Workflow for Step 1.1:

```
1. Read: "1.1 Create API Client Base"
2. Create: src/lib/api-client.ts
3. Copy: Code from guardrail
4. Verify: npm run typecheck (should pass)
5. Check: [✅] File created
6. Check: [✅] Code compiles
7. Check: [✅] TypeScript types correct
8. Move to: Step 1.2
```

---

## PROGRESS TRACKING

Update this section as you work:

**Current Step:** [Step Number and Name]  
**Status:** [ ] Not Started | [ ] In Progress | [ ] Complete  
**Started:** [Date/Time]  
**Completed:** [Date/Time]  
**Blockers:** [List any blockers]

**Completed Steps:**
- [ ] Step 1.1: Create API Client Base
- [ ] Step 1.2: Create Auth Store
- [ ] Step 1.3: Create API Types
- [ ] Step 1.4: Update Vite Config
- [ ] Step 1.5: Update Environment Example
- [ ] Step 1.6: Test API Client
- [ ] Step 2.1: Update Login Page
- [ ] Step 2.2: Update Auth Library
- [ ] ... (continue for all steps)

---

## VERIFICATION CHECKLIST TEMPLATE

For each step, verify:

**Code Quality:**
- [ ] Code compiles without errors
- [ ] TypeScript types are correct
- [ ] No linting errors
- [ ] Code follows project style

**Functionality:**
- [ ] Feature works as expected
- [ ] Error handling works
- [ ] Edge cases handled

**Integration:**
- [ ] Integrates with existing code
- [ ] No breaking changes (unless intended)
- [ ] Dependencies installed correctly

**Testing:**
- [ ] Manual testing passes
- [ ] Automated tests pass (if applicable)
- [ ] Edge cases tested

---

## TROUBLESHOOTING

If you encounter issues:

1. **Check the guardrail** - Is the step clear?
2. **Review code examples** - Did you copy correctly?
3. **Check dependencies** - Are all packages installed?
4. **Verify file paths** - Are files in correct locations?
5. **Review error messages** - What do they tell you?
6. **Check previous steps** - Did you complete prerequisites?

**Common Issues:**

| Issue | Solution |
|-------|----------|
| TypeScript errors | Check types match, enable strict mode gradually |
| Import errors | Verify file paths, check tsconfig paths |
| Runtime errors | Check browser console, verify API endpoints |
| Build failures | Check dependencies, verify Node version |

---

## COMMUNICATION PROTOCOL

### When Blocked:

1. **Document the blocker** in progress tracking
2. **Describe the issue** clearly
3. **Show error messages** if any
4. **Indicate what you tried** to resolve it
5. **Ask for help** with specific question

### When Complete:

1. **Mark step as complete** in guardrail
2. **Update progress tracking**
3. **Summarize what was done**
4. **Note any deviations** from plan
5. **Proceed to next step**

---

## QUALITY GATES

**Do NOT proceed if:**
- ❌ Current step verification fails
- ❌ Code doesn't compile
- ❌ Tests fail (if applicable)
- ❌ Breaking changes not documented
- ❌ Dependencies not installed

**DO proceed when:**
- ✅ All verification items checked
- ✅ Code compiles successfully
- ✅ Manual testing passes
- ✅ No blocking issues
- ✅ Ready for next step

---

## FINAL REMINDERS

**⚠️ CRITICAL:**
- Follow IMPLEMENTATION-GUARDRAIL.md exactly
- Do not skip steps
- Complete verification before moving on
- Use provided code examples
- Test thoroughly

**✅ SUCCESS CRITERIA:**
- All steps completed in order
- All verification items checked
- Code is production-ready
- Tests pass
- Documentation updated

---

**READY TO BEGIN?**

1. Open IMPLEMENTATION-GUARDRAIL.md
2. Start with Step 1.1
3. Follow the guardrail exactly
4. Check off items as you go
5. Report progress regularly

**Let's build something great! 🚀**

