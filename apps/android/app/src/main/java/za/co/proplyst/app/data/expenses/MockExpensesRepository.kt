package za.co.proplyst.app.data.expenses

import kotlinx.coroutines.delay
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class MockExpensesRepository @Inject constructor() : ExpensesRepository {
    override suspend fun createExpense(input: ExpenseCreateInput): ExpenseCreateResult {
        delay(400)
        if (input.amount <= 0) return ExpenseCreateResult.Error("Enter a valid amount.")
        return ExpenseCreateResult.Success("mock-expense-${System.currentTimeMillis()}")
    }
}
