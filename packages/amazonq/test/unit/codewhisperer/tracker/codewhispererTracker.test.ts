/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'assert'
import * as sinon from 'sinon'
import { assertTelemetryCurried } from 'aws-core-vscode/test'
import {
    AuthUtil,
    CodeWhispererTracker,
    userGroupKey,
    UserGroup,
    CodeWhispererUserGroupSettings,
} from 'aws-core-vscode/codewhisperer'
import { resetCodeWhispererGlobalVariables, createAcceptedSuggestionEntry } from 'aws-core-vscode/test'
import { globals, extensionVersion } from 'aws-core-vscode/shared'

describe('codewhispererTracker', function () {
    describe('enqueue', function () {
        beforeEach(async function () {
            await resetCodeWhispererGlobalVariables()
            await CodeWhispererTracker.getTracker().shutdown()
        })

        afterEach(function () {
            sinon.restore()
        })

        it('Should put suggestion in queue', function () {
            const suggestion = createAcceptedSuggestionEntry()
            const pushSpy = sinon.spy(Array.prototype, 'push')
            CodeWhispererTracker.getTracker().enqueue(suggestion)
            assert.ok(!pushSpy.neverCalledWith(suggestion))
        })

        it('Should not enque when telemetry is disabled', async function () {
            await globals.telemetry.setTelemetryEnabled(false)
            const suggestion = createAcceptedSuggestionEntry()
            const pushSpy = sinon.spy(Array.prototype, 'push')
            CodeWhispererTracker.getTracker().enqueue(suggestion)
            assert.ok(pushSpy.neverCalledWith(suggestion))
            await globals.telemetry.setTelemetryEnabled(true)
        })
    })

    describe('flush', function () {
        beforeEach(async function () {
            await resetCodeWhispererGlobalVariables()
            await CodeWhispererTracker.getTracker().shutdown()
        })

        afterEach(function () {
            sinon.restore()
        })

        it('Should call emit telemetry for event existed longer than 5 min, put back to queue if less than 5 min', async function () {
            const suggestion1 = createAcceptedSuggestionEntry(new Date())
            const suggestion2 = createAcceptedSuggestionEntry(new Date(Date.now() - 6 * 60 * 1000))
            const emitSpy = sinon.spy(CodeWhispererTracker.prototype, 'emitTelemetryOnSuggestion')
            CodeWhispererTracker.getTracker().enqueue(suggestion1)
            CodeWhispererTracker.getTracker().enqueue(suggestion2)
            await CodeWhispererTracker.getTracker().flush()
            assert.ok(emitSpy.calledOnce)
            assert.ok(!emitSpy.neverCalledWith(suggestion2))
            assert.ok(emitSpy.neverCalledWith(suggestion1))
        })

        it('Should skip if telemetry is disabled', async function () {
            await globals.telemetry.setTelemetryEnabled(false)
            const getTimeSpy = sinon.spy(Date.prototype, 'getTime')
            await CodeWhispererTracker.getTracker().flush()
            assert.ok(!getTimeSpy.called)
            await globals.telemetry.setTelemetryEnabled(true)
        })
    })

    describe('checkDiff', function () {
        it('Should return 1.0 distance for invalid input strings', function () {
            assert.strictEqual(CodeWhispererTracker.getTracker().checkDiff('', 'aabcd'), 1.0)
            assert.strictEqual(CodeWhispererTracker.getTracker().checkDiff('abbbacd', ''), 1.0)
        })

        it('Should return 1/levenshtein distance for valid input strings', function () {
            assert.strictEqual(CodeWhispererTracker.getTracker().checkDiff('abccd', 'aabcd'), 0.4)
        })
    })

    describe('emitTelemetryOnSuggestion', function () {
        beforeEach(function () {
            CodeWhispererUserGroupSettings.instance.reset()
        })

        afterEach(function () {
            CodeWhispererUserGroupSettings.instance.reset()
        })

        it('Should call recordCodewhispererUserModification with suggestion event', async function () {
            await globals.context.globalState.update(userGroupKey, {
                group: UserGroup.CrossFile,
                version: extensionVersion,
            })

            const testStartUrl = 'testStartUrl'
            sinon.stub(AuthUtil.instance, 'startUrl').value(testStartUrl)
            const suggestion = createAcceptedSuggestionEntry()
            const assertTelemetry = assertTelemetryCurried('codewhisperer_userModification')
            await CodeWhispererTracker.getTracker().emitTelemetryOnSuggestion(suggestion)
            assertTelemetry({
                codewhispererRequestId: 'test',
                codewhispererSessionId: 'test',
                codewhispererTriggerType: 'OnDemand',
                codewhispererSuggestionIndex: 1,
                codewhispererModificationPercentage: 1,
                codewhispererCompletionType: 'Line',
                codewhispererLanguage: 'java',
                credentialStartUrl: testStartUrl,
                codewhispererUserGroup: 'CrossFile',
            })
        })
    })
})
