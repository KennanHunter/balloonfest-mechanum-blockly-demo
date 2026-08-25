plugins {
    kotlin("jvm") version "2.1.20"
    application
}

repositories {
    mavenCentral()
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
    // Java 8 bytecode so the FTC Android build (targetCompatibility 1.8) can
    // consume this same source tree without a bytecode-level shim.
    sourceCompatibility = JavaVersion.VERSION_1_8
    targetCompatibility = JavaVersion.VERSION_1_8
}

kotlin {
    jvmToolchain(21)
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_1_8)
    }
}

dependencies {
    // NanoWSD ships in the NanoHTTPD extensions artifact; the FTC RC app
    // already bundles NanoHTTPD-core so this stays a single small dep.
    implementation("org.nanohttpd:nanohttpd-websocket:2.3.1")
    // Gson is on the FTC classpath via RobotCore; declared here for the
    // standalone build.
    implementation("com.google.code.gson:gson:2.10.1")
    // NanoHTTPD's SLF4J calls need a backend at runtime; simple prints to
    // stderr, keeps the console clean.
    runtimeOnly("org.slf4j:slf4j-simple:2.0.13")
}

application {
    mainClass.set("org.firstinspires.ftc.teamserver.MainKt")
}
