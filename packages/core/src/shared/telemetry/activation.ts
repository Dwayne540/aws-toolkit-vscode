/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import globals from '../extensionGlobals'

import * as nls from 'vscode-nls'
const localize = nls.loadMessageBundle()

import * as vscode from 'vscode'
import { AwsContext } from '../awsContext'
import { DefaultTelemetryService } from './telemetryService'
import { getLogger } from '../logger'
import { getComputeRegion, isAmazonQ, isCloud9, productName } from '../extensionUtilities'
import { openSettingsId, Settings } from '../settings'
import { TelemetryConfig, setupTelemetryId } from './util'
import { isAutomation, isReleaseVersion } from '../vscode/env'
import { AWSProduct } from './clienttelemetry'
import { DefaultTelemetryClient } from './telemetryClient'
import { telemetry } from './telemetry'
import { Commands } from '../vscode/commands2'

export const noticeResponseViewSettings = localize('AWS.telemetry.notificationViewSettings', 'Settings')
export const noticeResponseOk = localize('AWS.telemetry.notificationOk', 'OK')

// eslint-disable-next-line @typescript-eslint/naming-convention
export const TELEMETRY_NOTICE_VERSION_ACKNOWLEDGED = 'awsTelemetryNoticeVersionAck'

// Telemetry Notice Versions
// Versioning the users' notice acknowledgement is forward looking, and allows us to better
// track scenarios when we may need to re-prompt the user about telemetry.
// Version 1 was the original notice, allowing users to enable/disable/defer telemetry
// Version 2 states that there is metrics gathering, which can be adjusted in the options
const CURRENT_TELEMETRY_NOTICE_VERSION = 2 // eslint-disable-line @typescript-eslint/naming-convention

/**
 * Sets up the Metrics system and initializes globals.telemetry
 */
export async function activate(
    extensionContext: vscode.ExtensionContext,
    awsContext: AwsContext,
    settings: Settings,
    productName: AWSProduct
) {
    const config = new TelemetryConfig(settings)
    await config.initAmazonQSetting() // TODO: Remove after a few releases.

    DefaultTelemetryClient.productName = productName
    globals.telemetry = await DefaultTelemetryService.create(extensionContext, awsContext, getComputeRegion())

    const isAmazonQExt = isAmazonQ()
    try {
        await globals.telemetry.setTelemetryEnabled(config.isEnabled())

        extensionContext.subscriptions.push(
            (isAmazonQExt ? config.amazonQConfig : config.toolkitConfig).onDidChange(async event => {
                if (event.key === 'telemetry') {
                    const val = config.isEnabled()
                    const settingId = isAmazonQExt ? 'amazonQ.telemetry' : 'aws.telemetry'

                    // Record 'disabled' right before its turned off, so we can send this + the batch we have already.
                    if (!val) {
                        telemetry.aws_modifySetting.emit({ settingId, settingState: 'false', result: 'Succeeded' })
                    }

                    await globals.telemetry.setTelemetryEnabled(val)

                    // Record 'enabled' after its turned on, otherwise this is ignored.
                    if (val) {
                        telemetry.aws_modifySetting.emit({ settingId, settingState: 'true', result: 'Succeeded' })
                    }
                }
            })
        )

        if (isAmazonQExt) {
            extensionContext.subscriptions.push(
                Commands.register('aws.amazonq.setupTelemetryId', async () => {
                    await setupTelemetryId(extensionContext)
                })
            )
        }

        // Prompt user about telemetry if they haven't been
        if (!isCloud9() && !hasUserSeenTelemetryNotice(extensionContext)) {
            showTelemetryNotice(extensionContext)
        }
        await setupTelemetryId(extensionContext)
        await globals.telemetry.start()
    } catch (e) {
        // Only throw in a production build because:
        //   1. Telemetry must never prevent normal Toolkit operation.
        //   2. We want to know if something is not working ASAP during development.
        if (isAutomation() || !isReleaseVersion()) {
            throw e
        }

        getLogger().error(`telemetry: failed to activate: %s`, e)
    }
}

export function hasUserSeenTelemetryNotice(extensionContext: vscode.ExtensionContext): boolean {
    return (
        extensionContext.globalState.get<number>(TELEMETRY_NOTICE_VERSION_ACKNOWLEDGED, 0) >=
        CURRENT_TELEMETRY_NOTICE_VERSION
    )
}

export async function setHasUserSeenTelemetryNotice(extensionContext: vscode.ExtensionContext): Promise<void> {
    await extensionContext.globalState.update(TELEMETRY_NOTICE_VERSION_ACKNOWLEDGED, CURRENT_TELEMETRY_NOTICE_VERSION)
    getLogger().verbose('Telemetry notice has been shown')
}

/**
 * Prompts user to Enable/Disable/Defer on Telemetry, then
 * handles the response appropriately.
 */
function showTelemetryNotice(extensionContext: vscode.ExtensionContext) {
    getLogger().verbose('Showing telemetry notice')

    const telemetryNoticeText: string = localize(
        'AWS.telemetry.notificationMessage',
        '{0} collects anonymous usage metrics to improve the product. You can opt-out in settings.',
        productName()
    )

    // Don't wait for a response
    void vscode.window
        .showInformationMessage(telemetryNoticeText, noticeResponseViewSettings, noticeResponseOk)
        .then(async response => handleTelemetryNoticeResponse(response, extensionContext))
}

export async function handleTelemetryNoticeResponse(
    response: string | undefined,
    extensionContext: vscode.ExtensionContext
) {
    try {
        getLogger().verbose(`Telemetry notice response: ${response}`)

        if (!response) {
            // undefined == user discarded notice
            return
        }

        await setHasUserSeenTelemetryNotice(extensionContext)

        // noticeResponseOk is a no-op

        if (response === noticeResponseViewSettings) {
            await openSettingsId(isAmazonQ() ? 'amazonQ.telemetry' : 'aws.telemetry')
        }
    } catch (err) {
        getLogger().error('Error while handling response from telemetry notice: %O', err as Error)
    }
}
