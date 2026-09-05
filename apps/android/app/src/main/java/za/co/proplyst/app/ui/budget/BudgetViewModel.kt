package za.co.proplyst.app.ui.budget

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import za.co.proplyst.app.data.auth.AuthRepository
import za.co.proplyst.app.data.auth.AuthState
import za.co.proplyst.app.data.financials.AnnualBudget
import za.co.proplyst.app.data.financials.AnnualBudgetResult
import za.co.proplyst.app.data.financials.FinancialSummary
import za.co.proplyst.app.data.financials.FinancialSummaryRepository
import za.co.proplyst.app.data.financials.FinancialSummaryResult
import za.co.proplyst.app.data.properties.Property
import za.co.proplyst.app.data.properties.PropertiesRepository
import za.co.proplyst.app.data.properties.PropertiesResult
import java.time.LocalDate
import javax.inject.Inject

/** Owner Budget View (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §8, §9-E; annual view added in the
 *  Phase A budget-hierarchy pass, WORKLOG.md this date, once the server-authoritative annual
 *  rollup existed to build it on). Portfolio-wide by default (reuses the same live
 *  owner_portfolio_financial_summary() call Home uses -- one server-authoritative source, never
 *  independently recalculated here), with an optional property filter using the per-property
 *  financial-summary endpoint. Annual figures come from GET .../budget/annual, itself a pure
 *  server-side sum of 12 months -- never approximated client-side. */
enum class BudgetPeriod { MONTHLY, ANNUAL }

data class BudgetViewState(
    val properties: List<Property> = emptyList(),
    val selectedPropertyId: String? = null, // null = portfolio-wide
    val period: BudgetPeriod = BudgetPeriod.MONTHLY,
    val month: String = currentMonthIso(),
    val year: Int = LocalDate.now().year,
    val loading: Boolean = true,
    val summary: FinancialSummary? = null,
    val error: String? = null,
    val annualLoading: Boolean = false,
    val annualBudget: AnnualBudget? = null,
    val annualError: String? = null,
)

private fun currentMonthIso(): String {
    val now = LocalDate.now()
    return LocalDate.of(now.year, now.month, 1).toString()
}

@HiltViewModel
class BudgetViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val propertiesRepository: PropertiesRepository,
    private val financialSummaryRepository: FinancialSummaryRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(BudgetViewState())
    val state: StateFlow<BudgetViewState> = _state.asStateFlow()

    private fun currentOrgId(): String? =
        (authRepository.authState.value as? AuthState.Authenticated)?.organizations?.firstOrNull()?.orgId

    init {
        viewModelScope.launch {
            val properties = when (val result = propertiesRepository.getProperties()) {
                is PropertiesResult.Live -> result.properties
                is PropertiesResult.Cached -> result.properties
                is PropertiesResult.Error -> emptyList()
            }
            _state.value = _state.value.copy(properties = properties)
            load()
        }
    }

    fun selectProperty(propertyId: String?) {
        _state.value = _state.value.copy(selectedPropertyId = propertyId)
        load()
    }

    fun setPeriod(period: BudgetPeriod) {
        if (_state.value.period == period) return
        _state.value = _state.value.copy(period = period)
        if (period == BudgetPeriod.ANNUAL) loadAnnual()
    }

    fun load() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            val propertyId = _state.value.selectedPropertyId
            val month = _state.value.month
            val result = if (propertyId != null) {
                financialSummaryRepository.getFinancialSummary(propertyId, month)
            } else {
                val orgId = currentOrgId()
                if (orgId == null) {
                    _state.value = _state.value.copy(loading = false, error = "No organization found for this account.")
                    return@launch
                }
                financialSummaryRepository.getPortfolioFinancialSummary(orgId, month)
            }
            _state.value = when (result) {
                is FinancialSummaryResult.Loaded -> _state.value.copy(loading = false, summary = result.summary)
                is FinancialSummaryResult.Error -> _state.value.copy(loading = false, error = result.message)
            }
        }
        if (_state.value.period == BudgetPeriod.ANNUAL) loadAnnual()
    }

    private fun loadAnnual() {
        viewModelScope.launch {
            _state.value = _state.value.copy(annualLoading = true, annualError = null)
            val propertyId = _state.value.selectedPropertyId
            val year = _state.value.year
            val result = if (propertyId != null) {
                financialSummaryRepository.getPropertyBudgetAnnual(propertyId, year)
            } else {
                val orgId = currentOrgId()
                if (orgId == null) {
                    _state.value = _state.value.copy(annualLoading = false, annualError = "No organization found for this account.")
                    return@launch
                }
                financialSummaryRepository.getPortfolioBudgetAnnual(orgId, year)
            }
            _state.value = when (result) {
                is AnnualBudgetResult.Loaded -> _state.value.copy(annualLoading = false, annualBudget = result.budget)
                is AnnualBudgetResult.Error -> _state.value.copy(annualLoading = false, annualError = result.message)
            }
        }
    }
}
