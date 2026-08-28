package com.plethora.playbilling

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import java.util.concurrent.ConcurrentHashMap
import org.json.JSONArray

@InvokeArg
class GetProductsArgs {
    var ids: List<String>? = null
}

@InvokeArg
class PurchaseArgs {
    var productId: String? = null
    var obfuscatedAccountId: String? = null
}

@InvokeArg
class ManageSubscriptionsArgs {
    var productId: String? = null
}

@InvokeArg
class SetObfuscatedAccountIdArgs {
    var obfuscatedAccountId: String? = null
}

@TauriPlugin
class PlayBillingPlugin(private val activity: Activity) :
    Plugin(activity),
    PurchasesUpdatedListener {

    private val mainHandler = Handler(Looper.getMainLooper())

    private var billingClient: BillingClient? = null
    private var obfuscatedAccountId: String? = null
    private var purchaseListenerArmed = false
    private var pendingPurchaseInvoke: Invoke? = null
    private var pendingPurchaseProductId: String? = null

    /** Cached ProductDetails keyed by product id for launchBillingFlow. */
    private val productDetailsCache = ConcurrentHashMap<String, ProductDetails>()

    override fun load(webView: android.webkit.WebView) {
        super.load(webView)
        connectBillingClient()
    }

    override fun onDestroy() {
        billingClient?.endConnection()
        billingClient = null
        pendingPurchaseInvoke = null
        pendingPurchaseProductId = null
        super.onDestroy()
    }

    @Command
    fun getProducts(invoke: Invoke) {
        val args = invoke.parseArgs(GetProductsArgs::class.java)
        val ids = args.ids?.filter { it.isNotBlank() }?.ifEmpty { null } ?: DEFAULT_PRODUCT_IDS
        withReadyClient(invoke) { client ->
            val productList = ids.map { id ->
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(id)
                    .setProductType(BillingClient.ProductType.SUBS)
                    .build()
            }
            val params = QueryProductDetailsParams.newBuilder()
                .setProductList(productList)
                .build()
            client.queryProductDetailsAsync(params) { billingResult, detailsList ->
                if (billingResult.responseCode != BillingClient.BillingResponseCode.OK) {
                    invoke.reject(
                        billingResult.debugMessage ?: "PRODUCT_QUERY_FAILED",
                        "billing_error"
                    )
                    return@queryProductDetailsAsync
                }
                val products = JSONArray()
                for (details in detailsList) {
                    productDetailsCache[details.productId] = details
                    products.put(productPayload(details))
                }
                val result = JSObject()
                result.put("products", products)
                invoke.resolve(result)
            }
        }
    }

    @Command
    fun purchase(invoke: Invoke) {
        val args = invoke.parseArgs(PurchaseArgs::class.java)
        val productId = args.productId?.trim().orEmpty()
        if (productId.isEmpty()) {
            invoke.reject("productId is required", "invalid_argument")
            return
        }
        val accountId = args.obfuscatedAccountId?.trim()?.takeIf { it.isNotEmpty() }
            ?: obfuscatedAccountId
        withReadyClient(invoke) { client ->
            val cached = productDetailsCache[productId]
            if (cached != null) {
                launchPurchase(invoke, client, cached, productId, accountId)
                return@withReadyClient
            }
            queryProductDetails(client, listOf(productId)) { billingResult, detailsList ->
                if (billingResult.responseCode != BillingClient.BillingResponseCode.OK) {
                    invoke.resolve(
                        outcomePayload(
                            outcome = "failed",
                            reason = billingResult.debugMessage ?: "PRODUCT_QUERY_FAILED",
                            purchase = null
                        )
                    )
                    return@queryProductDetails
                }
                val details = detailsList.firstOrNull { it.productId == productId }
                if (details == null) {
                    invoke.resolve(
                        outcomePayload(
                            outcome = "failed",
                            reason = "PRODUCT_NOT_FOUND",
                            purchase = null
                        )
                    )
                    return@queryProductDetails
                }
                productDetailsCache[productId] = details
                launchPurchase(invoke, client, details, productId, accountId)
            }
        }
    }

    @Command
    fun queryPurchases(invoke: Invoke) {
        withReadyClient(invoke) { client ->
            queryActiveSubscriptions(client) { billingResult, purchases ->
                if (billingResult.responseCode != BillingClient.BillingResponseCode.OK) {
                    invoke.reject(
                        billingResult.debugMessage ?: "QUERY_PURCHASES_FAILED",
                        "billing_error"
                    )
                    return@queryActiveSubscriptions
                }
                val result = JSObject()
                result.put("purchases", purchasesToJson(purchases))
                invoke.resolve(result)
            }
        }
    }

    @Command
    fun restore(invoke: Invoke) {
        withReadyClient(invoke) { client ->
            queryActiveSubscriptions(client) { billingResult, purchases ->
                if (billingResult.responseCode != BillingClient.BillingResponseCode.OK) {
                    invoke.reject(
                        billingResult.debugMessage ?: "RESTORE_FAILED",
                        "billing_error"
                    )
                    return@queryActiveSubscriptions
                }
                val mapped = purchases.map { purchasePayload(it) }
                val restored = mapped.any { it.optString("purchaseState") == "purchased" }
                val result = JSObject()
                result.put("restored", restored)
                result.put("purchases", JSONArray(mapped))
                invoke.resolve(result)
            }
        }
    }

    @Command
    fun startPurchaseListener(invoke: Invoke) {
        purchaseListenerArmed = true
        invoke.resolve()
    }

    @Command
    fun manageSubscriptions(invoke: Invoke) {
        val args = invoke.parseArgs(ManageSubscriptionsArgs::class.java)
        val productId = args.productId?.trim().orEmpty()
        val packageName = activity.packageName
        val url = if (productId.isNotEmpty()) {
            "https://play.google.com/store/account/subscriptions?sku=$productId&package=$packageName"
        } else {
            "https://play.google.com/store/account/subscriptions?package=$packageName"
        }
        mainHandler.post {
            try {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                activity.startActivity(intent)
                invoke.resolve()
            } catch (e: Throwable) {
                invoke.reject(
                    e.message ?: "MANAGE_SUBSCRIPTIONS_FAILED",
                    "billing_error"
                )
            }
        }
    }

    @Command
    fun setObfuscatedAccountId(invoke: Invoke) {
        val args = invoke.parseArgs(SetObfuscatedAccountIdArgs::class.java)
        obfuscatedAccountId = args.obfuscatedAccountId?.trim()?.takeIf { it.isNotEmpty() }
        invoke.resolve()
    }

    override fun onPurchasesUpdated(billingResult: BillingResult, purchases: List<Purchase>?) {
        val responseCode = billingResult.responseCode
        val pending = pendingPurchaseInvoke
        val pendingProductId = pendingPurchaseProductId

        if (purchaseListenerArmed) {
            val event = JSObject()
            event.put("responseCode", responseCode)
            event.put("debugMessage", billingResult.debugMessage ?: "")
            event.put("purchases", purchasesToJson(purchases ?: emptyList()))
            trigger(PURCHASE_UPDATE_EVENT, event)
        }

        if (pending == null) return

        when (responseCode) {
            BillingClient.BillingResponseCode.OK -> {
                val purchase = purchases?.firstOrNull { purchase ->
                    pendingProductId == null ||
                        purchase.products.contains(pendingProductId)
                }
                if (purchase == null) {
                    pending.resolve(
                        outcomePayload(
                            outcome = "failed",
                            reason = "PURCHASE_NOT_FOUND",
                            purchase = null
                        )
                    )
                } else {
                    pending.resolve(outcomeForPurchase(purchase))
                }
            }
            BillingClient.BillingResponseCode.USER_CANCELED -> {
                pending.resolve(
                    outcomePayload(
                        outcome = "userCancelled",
                        reason = null,
                        purchase = null
                    )
                )
            }
            else -> {
                pending.resolve(
                    outcomePayload(
                        outcome = "failed",
                        reason = billingResult.debugMessage ?: "BILLING_ERROR",
                        purchase = null
                    )
                )
            }
        }
        pendingPurchaseInvoke = null
        pendingPurchaseProductId = null
    }

    private fun connectBillingClient() {
        if (billingClient != null) return
        billingClient = BillingClient.newBuilder(activity)
            .setListener(this)
            .enablePendingPurchases()
            .build()
        billingClient?.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(billingResult: BillingResult) {
                // Ready when response is OK; commands wait via withReadyClient.
            }

            override fun onBillingServiceDisconnected() {
                productDetailsCache.clear()
            }
        })
    }

    private fun withReadyClient(invoke: Invoke, block: (BillingClient) -> Unit) {
        val client = billingClient
        if (client == null) {
            invoke.reject("BillingClient not initialized", "billing_error")
            return
        }
        if (client.isReady) {
            block(client)
            return
        }
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(billingResult: BillingResult) {
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    block(client)
                } else {
                    invoke.reject(
                        billingResult.debugMessage ?: "BILLING_SETUP_FAILED",
                        "billing_error"
                    )
                }
            }

            override fun onBillingServiceDisconnected() {
                productDetailsCache.clear()
            }
        })
    }

    private fun queryProductDetails(
        client: BillingClient,
        ids: List<String>,
        callback: (BillingResult, List<ProductDetails>) -> Unit
    ) {
        val productList = ids.map { id ->
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId(id)
                .setProductType(BillingClient.ProductType.SUBS)
                .build()
        }
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(productList)
            .build()
        client.queryProductDetailsAsync(params, callback)
    }

    private fun queryActiveSubscriptions(
        client: BillingClient,
        callback: (BillingResult, List<Purchase>) -> Unit
    ) {
        val params = QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.SUBS)
            .build()
        client.queryPurchasesAsync(params, callback)
    }

    private fun launchPurchase(
        invoke: Invoke,
        client: BillingClient,
        details: ProductDetails,
        productId: String,
        accountId: String?
    ) {
        val offer = details.subscriptionOfferDetails?.firstOrNull()
        if (offer == null) {
            invoke.resolve(
                outcomePayload(
                    outcome = "failed",
                    reason = "NO_SUBSCRIPTION_OFFER",
                    purchase = null
                )
            )
            return
        }
        val productParams = BillingFlowParams.ProductDetailsParams.newBuilder()
            .setProductDetails(details)
            .setOfferToken(offer.offerToken)
            .build()
        val flowBuilder = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(listOf(productParams))
        if (!accountId.isNullOrEmpty()) {
            flowBuilder.setObfuscatedAccountId(accountId)
        }
        val flowParams = flowBuilder.build()

        mainHandler.post {
            pendingPurchaseInvoke = invoke
            pendingPurchaseProductId = productId
            val launchResult = client.launchBillingFlow(activity, flowParams)
            if (launchResult.responseCode != BillingClient.BillingResponseCode.OK) {
                pendingPurchaseInvoke = null
                pendingPurchaseProductId = null
                invoke.resolve(
                    outcomePayload(
                        outcome = when (launchResult.responseCode) {
                            BillingClient.BillingResponseCode.USER_CANCELED -> "userCancelled"
                            else -> "failed"
                        },
                        reason = launchResult.debugMessage,
                        purchase = null
                    )
                )
            }
        }
    }

    private fun outcomeForPurchase(purchase: Purchase): JSObject {
        return when (purchase.purchaseState) {
            Purchase.PurchaseState.PURCHASED -> outcomePayload(
                outcome = "purchased",
                reason = null,
                purchase = purchasePayload(purchase)
            )
            Purchase.PurchaseState.PENDING -> outcomePayload(
                outcome = "pending",
                reason = null,
                purchase = purchasePayload(purchase)
            )
            else -> outcomePayload(
                outcome = "failed",
                reason = "UNKNOWN_PURCHASE_STATE",
                purchase = purchasePayload(purchase)
            )
        }
    }

    private fun outcomePayload(
        outcome: String,
        reason: String?,
        purchase: JSObject?
    ): JSObject {
        val wrapper = JSObject()
        val payload = JSObject()
        payload.put("outcome", outcome)
        payload.put("reason", reason)
        payload.put("purchase", purchase)
        wrapper.put("outcome", payload)
        return wrapper
    }

    private fun productPayload(details: ProductDetails): JSObject {
        val offer = details.subscriptionOfferDetails?.firstOrNull()
        val phase = offer?.pricingPhases?.pricingPhaseList?.firstOrNull()
        val obj = JSObject()
        obj.put("id", details.productId)
        obj.put("displayName", details.name)
        obj.put("description", details.description)
        obj.put("priceFormatted", phase?.formattedPrice ?: "")
        obj.put("currency", phase?.priceCurrencyCode ?: "")
        obj.put("period", normalizedPeriod(phase?.billingPeriod))
        return obj
    }

    private fun purchasePayload(purchase: Purchase): JSObject {
        val productId = purchase.products.firstOrNull().orEmpty()
        val obj = JSObject()
        obj.put("productId", productId)
        obj.put("purchaseToken", purchase.purchaseToken)
        obj.put("orderId", purchase.orderId ?: "")
        obj.put("purchaseTimeMs", purchase.purchaseTime)
        obj.put("purchaseState", purchaseStateName(purchase.purchaseState))
        obj.put("autoRenewing", purchase.isAutoRenewing)
        obj.put("acknowledged", purchase.isAcknowledged)
        obj.put("obfuscatedAccountId", purchase.accountIdentifiers?.obfuscatedAccountId)
        return obj
    }

    private fun purchasesToJson(purchases: List<Purchase>): JSONArray {
        val array = JSONArray()
        for (purchase in purchases) {
            array.put(purchasePayload(purchase))
        }
        return array
    }

    private fun purchaseStateName(state: Int): String = when (state) {
        Purchase.PurchaseState.PURCHASED -> "purchased"
        Purchase.PurchaseState.PENDING -> "pending"
        else -> "unknown"
    }

    private fun normalizedPeriod(billingPeriod: String?): String? {
        if (billingPeriod.isNullOrBlank()) return null
        val upper = billingPeriod.uppercase()
        return when {
            upper == "P1M" -> "monthly"
            upper == "P1Y" -> "annual"
            upper.startsWith("P") && upper.endsWith("M") -> {
                val months = upper.drop(1).dropLast(1).toIntOrNull() ?: 0
                if (months >= 12) "annual" else "monthly"
            }
            upper.startsWith("P") && upper.endsWith("Y") -> "annual"
            else -> billingPeriod
        }
    }

    companion object {
        const val PRO_MONTHLY = "plethora_pro_monthly"
        const val PRO_ANNUAL = "plethora_pro_annual"
        val DEFAULT_PRODUCT_IDS = listOf(PRO_MONTHLY, PRO_ANNUAL)

        /** Event name for registerListener / trigger purchase updates. */
        const val PURCHASE_UPDATE_EVENT = "plethora-playbilling-purchase-update"
    }
}
