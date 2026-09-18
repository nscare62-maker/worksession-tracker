package com.worksession.tracker.ui.login

import android.os.Bundle
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import com.worksession.tracker.databinding.ActivityLoginBinding
import com.worksession.tracker.ui.manager.ManagerActivity
import com.worksession.tracker.ui.worker.WorkerActivity
import com.worksession.tracker.utils.isVisible
import com.worksession.tracker.utils.startActivity
import com.worksession.tracker.utils.toast

class LoginActivity : AppCompatActivity() {

    private lateinit var binding: ActivityLoginBinding
    private val viewModel: LoginViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(binding.root)

        observeViewModel()
        setupClickListeners()
    }

    private fun observeViewModel() {
        viewModel.uiState.observe(this) { state ->
            binding.progressBar.isVisible = state.isLoading
            binding.btnLogin.isEnabled    = !state.isLoading

            state.error?.let { msg ->
                toast(msg, long = true)
                viewModel.clearError()
            }

            state.user?.let { user ->
                when (user.role) {
                    "manager", "admin" -> startActivity<ManagerActivity>(clearStack = true)
                    else               -> startActivity<WorkerActivity>(clearStack = true)
                }
                finish()
            }
        }
    }

    private fun setupClickListeners() {
        binding.btnLogin.setOnClickListener {
            val email    = binding.etEmail.text?.toString()?.trim() ?: ""
            val password = binding.etPassword.text?.toString()?.trim() ?: ""
            if (email.isBlank()) {
                toast("Please enter your email")
                return@setOnClickListener
            }
            if (password.isBlank()) {
                toast("Please enter your password")
                return@setOnClickListener
            }
            viewModel.login(email, password)
        }
    }
}